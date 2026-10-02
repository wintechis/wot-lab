import { globalState, normalizeThingId } from '../globalState.js';
import { labPrefix } from '../http/labApi.js';
import { batteryClass, finishedProductClass, linkedProducts, productTurtle } from '../things/resourceTurtle.js';
import { isResourceId, resourceMeta } from '../things/resources.js';
import { createLoggers } from '../utils/debug.js';
import { SolidFetch } from './dpopFetch.js';
import { numberBuildProducts, productSerial, productsContainerIn } from './serials.js';
import { Interaction, provenanceToTurtle, StateSnapshot, ThingState } from './stateResource.js';

const { debug, warn } = createLoggers('solid');

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * One Thing's state, detached, or `{}` if it cannot be.
 *
 * `JSON.stringify` throws on a cyclic structure, on a `BigInt`, and on nesting
 * deep enough to exhaust the stack. A Thing's state is whatever its handler put
 * there, so none of those is the lab's to rule out — and because every Thing is
 * cloned for every record, an unclonable value in one Thing would otherwise make
 * every interaction with every Thing fail. Per Thing, so the rest of a record
 * survives one bad Thing.
 */
function detach(id: string, state: Record<string, unknown>): Record<string, unknown> {
  try {
    return clone(state);
  } catch (cause) {
    warn(`Could not detach the state of '${id}': ${cause instanceof Error ? cause.message : String(cause)}`);
    return {};
  }
}

/**
 * The header a client names itself in, lowercased as Node presents headers.
 *
 * A header rather than anything cleverer because the client of a WoT lab is
 * usually a script: one line of curl is the whole cost of appearing in the log
 * as yourself instead of as an address.
 */
export const defaultAgentHeader = 'x-agent';

export interface StateSinkOptions {
  /**
   * The LDP container the lab writes to. Always ends in a slash. It holds two
   * containers of its own: `traces/`, for the record of every interaction, and
   * `products/`, for the finished products and the products they link to.
   */
  container: string;
  /** Where this lab's Things are served from, e.g. `http://localhost:8081`. */
  thingBaseUrl: string;
  /** The header naming the requesting agent; `defaultAgentHeader` when unset. */
  agentHeader?: string;
  /**
   * How the pod is reached: `createDpopFetch(...)` for a pod that wants
   * Solid-OIDC, the global `fetch` — the default — for one that does not.
   *
   * Passed in rather than built here because credentials are configuration, and
   * a sink that read them would make every unauthenticated pod carry the import
   * and every test that posts carry a client id.
   */
  fetch?: SolidFetch;
  /**
   * The URI of the environment currently running, read at post time rather than
   * captured — an environment can be started and replaced while the lab runs.
   * A URI rather than a name so a record links to the manifest a run came from;
   * the caller knows where that is served, this module does not.
   */
  // eslint-disable-next-line no-unused-vars
  environmentIri?: () => string | undefined;
  /**
   * A name for the run currently going, when one is — the serial number of what it
   * builds, as one path segment. Read at post time for the same reason as
   * `environmentIri`: a run can end and another begin while the lab stays up.
   *
   * A name and not a URI, because where a run's records live is this module's
   * business: it becomes a container under `container`, which is a resource that
   * answers a GET and lists the records belonging to the run. What the name *says*
   * is the caller's: this module only needs one run to be told from the next, and
   * `serials.ts` is where a name is chosen that a reader can also look up.
   */
  // eslint-disable-next-line no-unused-vars
  runId?: () => string | undefined;
}

// A pod is a remote server on the far side of a network, so posting is never in
// the request's path: snapshots queue here and drain behind the response.
//
// The queue is bounded because it is fed by inbound traffic it cannot slow down.
// A pod that stops answering would otherwise turn every further interaction into
// retained memory; past this many waiting snapshots the lab drops them and says
// so, which is the right failure for an observer that must not perturb what it
// observes.
//
// The bound is generous because the records are the point of a run: a scripted
// replay fires a few hundred interactions a second, far faster than a pod
// accepts them, and a bound of a few hundred silently cut the tail off such a
// run. A record is the whole environment as Turtle, tens of kilobytes, so this
// many waiting is a few hundred megabytes at worst.
const maxPending = 10_000;

// Long enough for a pod on a slow link, short enough that a black-holed
// connection cannot hold a queue slot indefinitely.
const requestTimeoutMs = 10_000;

// Snapshots drain down a few parallel lanes rather than one queue. One queue
// would cap the lab at a snapshot per round-trip — on a pod 100ms away, ten a
// second, which a benchmark replay exceeds and would then lose. Order survives
// the parallelism because every snapshot carries its own `prov:generatedAtTime`:
// the sequence is in the resources, not in the order the pod received them.
const concurrency = 4;

let options: StateSinkOptions | undefined;
let pending = 0;
// Where in its run a state sits. Counted at enqueue time, which is the only place
// the order is known: posts drain down `concurrency` lanes and finish out of
// order, and the pod-minted URI a record lands on is not known until its own POST
// returns — so a chain built from those would either be wrong or would serialise
// the lanes it exists to keep parallel. The lab names each state instead, from the
// run it belongs to and its place in that run, and every record says which name is
// its own. The chain is then correct whatever order the pod sees.
let sequence = 0;
let sequenceRunId: string | undefined;
// The record each next record follows, remembered as records are enqueued. The
// lab chooses where a record goes, so this is known before the record is written
// and nothing waits on a POST to learn it — which is what keeps the lanes below
// parallel while still chaining every record to a URI that will resolve.
let previousRecordIri: string | undefined;
// One creation attempt per run, shared by every lane: four lanes starting at once
// would otherwise race to create the same container.
const containersMade = new Map<string, Promise<boolean>>();
// How far the times the pod is told differ from the clock, and the run that
// difference belongs to. Zero for a run nobody asked to date elsewhere, which is
// every run but one an order backdated — see `backdateRun`.
let backdateMs = 0;
let backdateRunId: string | undefined;
// When each product of the run now going came into existence, by the clock the run
// is dated by. Filled as interactions are published, because that is where a
// product's birth is observed: a product that exists now and did not when the
// request arrived was made by it. Read when a product is written, so a phone and
// the battery inside it each carry the moment it was made rather than the moment
// the phone's documents happened to be rendered.
//
// A run's own, cleared with the sequence: a product has the same id every run, and
// a time carried across would date this run's phone by the last run's.
const producedAt = new Map<string, Date>();

/**
 * Make sure a run's container exists, once per run.
 *
 * `PUT` with the container type rather than `POST` with a slug, because the lab
 * decides what a run's container is called — a pod that minted the name would
 * hand back a URI the next record could not predict. `false` means the pod would
 * not have it, and records fall back to the flat container: a run that is not
 * grouped is worth more than a run that is not recorded.
 */
function ensureContainer(sink: StateSinkOptions, container: string): Promise<boolean> {
  const existing = containersMade.get(container);
  if (existing) {
    return existing;
  }
  const send = sink.fetch ?? fetch;
  const attempt = send(container, {
    method: 'PUT',
    headers: {
      'Content-Type': 'text/turtle',
      Link: '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"'
    },
    body: '',
    signal: AbortSignal.timeout(requestTimeoutMs)
  }).then(async response => {
    // 201 is a fresh container; a pod that already has it answers 200/204/205, and
    // 409/412 is a pod saying it is already there. None of those is a failure.
    if (response.ok || response.status === 409 || response.status === 412) {
      debug(`Run container ${container} ready (${response.status})`);
      return true;
    }
    const detail = (await response.text().catch(() => '')).slice(0, 200);
    warn(`Pod refused the run container ${container}: ${response.status} ${response.statusText} ${detail}`);
    return false;
  }).catch((cause: unknown) => {
    warn(`Could not create the run container ${container}: ${cause instanceof Error ? cause.message : String(cause)}`);
    return false;
  });
  containersMade.set(container, attempt);
  return attempt;
}
/** Where the records of every interaction go, one container per build inside. */
function tracesContainer(sink: StateSinkOptions): string {
  return `${sink.container}traces/`;
}

/** Where finished products and the products they link to go, one container per build inside. */
function productsContainer(sink: StateSinkOptions): string {
  return productsContainerIn(sink.container);
}

/** Where a given run's products go — the flat container when there is no run. */
function productsRunContainer(sink: StateSinkOptions, runId: string | undefined): string {
  return runId ? `${productsContainer(sink)}${encodeURIComponent(runId)}/` : productsContainer(sink);
}

/**
 * Where the pod holds a product of the run currently going, when products are
 * being written.
 *
 * So something that caused a product to be made can point at the copy in the pod
 * rather than at the lab: the lab serves one product per id and will serve the
 * next run's as soon as that one is made, while the pod's copy belongs to the run
 * that made it and stays what it was.
 */
export function currentProductIri(id: string): string | undefined {
  const sink = options;
  return sink ? `${productsRunContainer(sink, sink.runId?.())}${encodeURIComponent(id)}` : undefined;
}

/**
 * Date what the run now going writes from `asOf` rather than from the clock.
 *
 * This is how a pod comes to hold history rather than only a present: an order
 * that says when it was placed is built now and recorded as having been built
 * then. What is shifted is every time the lab *claims* — each record's activity,
 * each product's birth, the order's fulfilment — by one offset, so the run keeps
 * the durations it really had and reads as a run of that length at that moment.
 *
 * The offset belongs to the run, not to the lab: a record that drains after the
 * order has finished is still a record of its run and is still dated with it,
 * while a run begun by a reset or by the next order is dated by the clock again
 * unless it asks not to be. `undefined` says this run is not backdated at all.
 *
 * Only the times written to the pod move. Logs, the poll loop and every timeout
 * stay on the clock, because a lab that moved its own sense of now would answer
 * a request from a past it is not in.
 */
export function backdateRun(asOf: Date | undefined): void {
  if (asOf === undefined || Number.isNaN(asOf.getTime())) {
    backdateMs = 0;
    backdateRunId = undefined;
    return;
  }
  backdateMs = asOf.getTime() - Date.now();
  backdateRunId = options?.runId?.();
  debug(`Dating the run from ${asOf.toISOString()} (${backdateMs}ms off the clock)`);
}

/**
 * One real time as the run it belongs to reports it.
 *
 * The run is checked rather than assumed, so an offset one run asked for cannot
 * leak into the next: `runId` is what a record is filed under, and a time is
 * shifted exactly when the record carrying it belongs to the backdated run.
 */
function runTime(real: Date, runId: string | undefined): Date {
  return backdateMs && runId === backdateRunId ? new Date(real.getTime() + backdateMs) : real;
}

/** Now, as the run currently going reports it — the clock, unless it is backdated. */
export function podNow(): Date {
  return runTime(new Date(), options?.runId?.());
}

/**
 * When a product of the run now going came into existence, if the lab saw it
 * happen.
 *
 * Nothing for a raw material: it was on the floor when the run began, and the lab
 * has no basis for a date it did not witness. Nothing either in a lab with no
 * container configured, which observes no production at all.
 */
export function productGeneratedAt(id: string): Date | undefined {
  return producedAt.get(normalizeThingId(id));
}

/**
 * Whether a product an Action generated is one the pod gets a copy of: a finished
 * product, or a battery, which a finished product links. Every other generated
 * product is an intermediate that ends up consumed and is never written, so a
 * record naming its pod URI would point at nothing.
 */
function isSavedProduct(id: string): boolean {
  const types = resourceMeta(id)?.types ?? [];
  return types.includes(finishedProductClass) || types.includes(batteryClass);
}

const lanes: Promise<void>[] = Array.from({ length: concurrency }, () => Promise.resolve());
let nextLane = 0;
let dropped = 0;
// Writes that did not reach the pod, since the lab came up: refused by it, failed
// on the way, or dropped for want of room in the queue. Counted so that something
// which *depends* on the pod holding a run — an order saying it is fulfilled — can
// ask whether it does. `drainStateSink` says when the queue is empty, which is not
// the same as saying everything in it arrived: a pod answering 401 to every write
// empties the queue as fast as one that accepts them.
let unwritten = 0;

/**
 * How many writes have failed to reach the pod so far. Read before and after a
 * stretch of work, the difference is what that stretch failed to record.
 */
export function unwrittenCount(): number {
  return unwritten;
}

/**
 * Point the sink at a container. Without this call nothing is posted, which is
 * what makes the feature opt-in: no container configured, no outbound traffic.
 */
export function configureStateSink(next: StateSinkOptions): void {
  options = next;
  // Both up front, so the layout is there to see before the first record is.
  void ensureContainer(next, tracesContainer(next));
  void ensureContainer(next, productsContainer(next));
  debug(`Posting Thing state to ${tracesContainer(next)}, products to ${productsContainer(next)}`);
}

/**
 * The container this run's records are posted to, when records are being posted.
 *
 * So a resource can point at where its history is being written. The container and
 * not a per-product trace: a record covers the whole environment, because a recipe
 * changes several Things at once, and separating one product's history out of that
 * is a question for a reader of the records rather than a claim this module can
 * make. It resolves, and it lists every record of the run.
 */
export function currentRunContainer(): string | undefined {
  const sink = options;
  const runId = sink?.runId?.();
  return sink && runId ? `${tracesContainer(sink)}${encodeURIComponent(runId)}/` : undefined;
}

export function isStateSinkEnabled(): boolean {
  return options !== undefined;
}

/** Lowercased, because that is how Node keys `req.headers`. */
export function agentHeaderName(): string {
  return (options?.agentHeader ?? defaultAgentHeader).toLowerCase();
}

/**
 * The name suggested to the pod. A `Slug` is a request, not an instruction — the
 * server may adjust it or ignore it and mint its own name — so nothing here
 * depends on the resulting URI having this shape. Colons and dots are replaced
 * because a slug becomes a path segment.
 */
function slugFor(interaction: Interaction): string {
  const stamp = interaction.endedAt.toISOString().replace(/[:.]/g, '-');
  return `${interaction.thingId}-${stamp}`;
}

/**
 * What a record is called inside its run's container.
 *
 * The position first and zero-padded, so a listing of the container reads in the
 * order the interactions happened — a pod sorts its members as strings, and
 * `10` before `9` would make the one listing a reader gets for free useless. The
 * Thing after it, because that is what a reader scanning the listing is looking
 * for. Position and not a timestamp, because two interactions can finish in the
 * same millisecond and a name that collides would have one record overwrite the
 * other.
 */
function recordName(position: number, thingId: string): string {
  return `${String(position).padStart(8, '0')}-${encodeURIComponent(thingId)}`;
}

/** Where a Thing is served: at the lab's root, under its id. */
function thingIri(sink: StateSinkOptions, id: string): string {
  return `${sink.thingBaseUrl}/${encodeURIComponent(id)}`;
}

/**
 * The Properties a record leaves out: a station's service and the shopfloor's
 * recipe book and service list. They describe how the factory is set up, not what
 * an interaction did to it — no Action changes them — so recording them in every
 * record would repeat the same setup once per interaction.
 */
const unrecordedProperties = new Set(['recipes', 'service', 'services']);

function recordedState(state: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(state).filter(([name]) => !unrecordedProperties.has(name)));
}

/**
 * Every running Thing's state, in creation order.
 *
 * The whole environment rather than the addressed Thing alone, because a WoT
 * interaction is not confined to the Thing it names: a cross-Thing VRE effect
 * changes others, and those changes belong to the interaction that caused them.
 * The cost is one record's size — a record now grows with the environment — and
 * it is paid once per interaction, off the request's path.
 *
 * Things only. A product is a resource with a representation of its own, which
 * links the records of the run that made it; its state is not repeated in them.
 */
function everyThingState(sink: StateSinkOptions): ThingState[] {
  const things = globalState.things as Record<string, Record<string, unknown>>;
  return Object.keys(things).filter(id => !isResourceId(id)).map(id => ({
    id,
    iri: thingIri(sink, id),
    state: recordedState(detach(id, things[id]))
  }));
}

/**
 * The products that exist right now: produced, or a raw material, and not yet
 * consumed — which a product's own `state` says by being `initialState`.
 *
 * Taken when a request arrives and again when it finishes, so a record can name
 * the products the interaction brought into existence.
 */
export function existingProducts(): Set<string> {
  const things = globalState.things as Record<string, Record<string, unknown>>;
  return new Set(Object.keys(things).filter(id => isResourceId(id) && things[id].state === 'initialState'));
}

/**
 * Write one record to the pod.
 *
 * `PUT` to a URI this module chose when the snapshot was enqueued, rather than
 * `POST` to a container that mints one. The record has to name the record before
 * it, and a pod-minted name is not known until its own POST returns — so a chain
 * built from those would either be wrong or would make every write wait for the
 * one before it, which is the parallelism the lanes exist for. Choosing the name
 * costs nothing and the link resolves.
 *
 * A pod that would not have the run's container is not an error worth losing a
 * record over: `target` falls back to the flat container, posted the old way.
 */
async function post(snapshot: StateSnapshot, sink: StateSinkOptions, target?: string): Promise<void> {
  const body = provenanceToTurtle(snapshot);
  const send = sink.fetch ?? fetch;
  const grouped = target !== undefined
    && await ensureContainer(sink, tracesContainer(sink))
    && await ensureContainer(sink, containerOf(target));
  const response = grouped
    ? await send(target as string, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/turtle' },
      body,
      signal: AbortSignal.timeout(requestTimeoutMs)
    })
    : await send(tracesContainer(sink), {
      method: 'POST',
      headers: {
        'Content-Type': 'text/turtle',
        // Asks the container for a plain RDF source rather than a new container.
        Link: '<http://www.w3.org/ns/ldp#Resource>; rel="type"',
        Slug: slugFor(snapshot.interaction)
      },
      body,
      signal: AbortSignal.timeout(requestTimeoutMs)
    });

  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 200);
    warn(`Pod refused a snapshot of '${snapshot.interaction.thingId}': ${response.status} ${response.statusText} ${detail}`);
    unwritten += 1;
    return;
  }

  // Where the record went: the URI this module chose, or — for the flat fallback —
  // the one the pod minted, which a container answering 200/204 does not report.
  const location = grouped ? target : response.headers.get('location');
  debug(`Posted state of '${snapshot.interaction.thingId}'${location ? ` as ${new URL(location, tracesContainer(sink)).href}` : ''}`);
}

/** The container a record URI sits in — everything up to its last slash. */
function containerOf(recordIri: string): string {
  return recordIri.slice(0, recordIri.lastIndexOf('/') + 1);
}

/**
 * Publish the provenance of one WoT interaction.
 *
 * Returns immediately: the caller is an HTTP handler, and a pod's latency is not
 * the client's problem. A pod that is down or slow costs a warning and nothing
 * else, and an unclonable Thing state costs that Thing's members. The caller
 * guards the call as well: this runs from a `finish` hook, where a throw would
 * reach the process rather than the request.
 *
 * `productsBefore` is `existingProducts()` as the request arrived; a product that
 * exists now and did not then is one this interaction produced.
 */
export function publishThingState(interaction: Interaction, productsBefore?: Set<string>): void {
  const sink = options;
  if (!sink) {
    return;
  }

  const id = normalizeThingId(interaction.thingId);
  const state = (globalState.things as Record<string, Record<string, unknown>>)[id];
  if (!state) {
    // A path shaped like an affordance but naming no running Thing: the request
    // was a 404, and there is no state to report.
    debug(`No state for '${id}'; nothing posted`);
    return;
  }

  if (pending >= maxPending) {
    dropped += 1;
    unwritten += 1;
    // One line per backlog, not one per drop: the pod being unreachable would
    // otherwise be as noisy as the traffic it is failing to record.
    if (dropped === 1 || dropped % 100 === 0) {
      warn(`Snapshot queue full (${maxPending}); dropped ${dropped} snapshot(s) so far`);
    }
    return;
  }

  const runId = sink.runId?.();
  // A run of its own restarts the count and breaks the chain: a position is a
  // position within a run, and carrying either across runs would chain a state to
  // a state of a different run.
  if (runId !== sequenceRunId) {
    sequenceRunId = runId;
    sequence = 0;
    previousRecordIri = undefined;
    // And the products of the run that just ended: this run makes its own, and
    // every id is about to be used again.
    producedAt.clear();
  }
  const position = sequence;
  sequence += 1;

  // Where this record will go, decided now so the next one can point at it.
  const runContainer = runId ? `${tracesContainer(sink)}${encodeURIComponent(runId)}/` : undefined;
  const productsRun = productsRunContainer(sink, runId);
  const recordIri = runContainer ? `${runContainer}${recordName(position, id)}` : undefined;
  const previous = previousRecordIri;
  if (recordIri) {
    previousRecordIri = recordIri;
  }

  // The products that exist now and did not when the request arrived: what this
  // interaction produced.
  const generated = productsBefore
    ? [...existingProducts()].filter(product => !productsBefore.has(product))
    : [];

  // When this interaction happened, as the run it belongs to reports it — the
  // clock, unless an order asked for its run to be dated elsewhere.
  const startedAt = runTime(interaction.startedAt, runId);
  const endedAt = runTime(interaction.endedAt, runId);
  // The interaction that produced a product is when it came into existence, which
  // is the one fact about a product's birth the lab is in a position to state.
  // Overwritten rather than kept, because a product consumed and produced again in
  // one run was last made now.
  for (const product of generated) {
    producedAt.set(product, endedAt);
  }

  const snapshot: StateSnapshot = {
    interaction: { ...interaction, thingId: id, startedAt, endedAt },
    thingIri: thingIri(sink, id),
    environmentIri: sink.environmentIri?.(),
    runIri: runContainer,
    // The `#state` of the record before this one, which is a URI that resolves:
    // the lab chose it, and that record is being written to it.
    previousStateIri: previous ? `${previous}#state` : undefined,
    // Read now, not when the POST runs: by then the next interaction may have
    // changed it, and this resource claims to be the state *this* request left.
    // Serialising through JSON also flattens the Valtio proxies the Things' own
    // handlers serve, which is what the rest of the lab does to detach state.
    things: everyThingState(sink),
    // Named where the pod will hold them. A battery is written only once a phone
    // it went into is finished, so until then — and in a run that never finishes
    // one — its link is to a document not yet there.
    generatedProducts: generated.filter(isSavedProduct).map(product => `${productsRun}${encodeURIComponent(product)}`)
  };

  enqueue(() => post(snapshot, sink, recordIri), `state of '${id}'`);

  // A finished product goes to the pod with everything it links, rendered now for
  // the same reason the states are: this is what the interaction left.
  for (const finished of generated.filter(product => resourceMeta(product)?.types.includes(finishedProductClass))) {
    const documents = [finished, ...linkedProducts(finished)];
    // Numbered before any of them is rendered, because each one carries its own
    // serial and the finished product's is the build's — which is the name of the
    // container they are all about to be written into.
    numberBuildProducts(documents);
    for (const product of documents) {
      const body = productTurtle(product, {
        trace: runContainer,
        generatedAt: producedAt.get(product),
        serial: productSerial(product)
      });
      if (body !== undefined) {
        enqueue(() => putProduct(sink, `${productsRun}${encodeURIComponent(product)}`, body), `product '${product}'`);
      }
    }
  }
}

/**
 * Write one product resource to the pod, as the lab serves it.
 *
 * Named by its id beside the products it links, so its relative links — `<cpu#product>`
 * — resolve to the copies written with it rather than to the lab.
 */
async function putProduct(sink: StateSinkOptions, target: string, body: string): Promise<void> {
  const send = sink.fetch ?? fetch;
  if (!await ensureContainer(sink, productsContainer(sink)) || !await ensureContainer(sink, containerOf(target))) {
    warn(`No container for ${target}; product not written`);
    unwritten += 1;
    return;
  }
  const response = await send(target, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/turtle' },
    body,
    signal: AbortSignal.timeout(requestTimeoutMs)
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 200);
    warn(`Pod refused ${target}: ${response.status} ${response.statusText} ${detail}`);
    unwritten += 1;
    return;
  }
  debug(`Wrote ${target}`);
}

/** Queue one write down the next lane, counted against the backlog. */
function enqueue(write: () => Promise<void>, what: string): void {
  pending += 1;
  const lane = nextLane;
  nextLane = (nextLane + 1) % concurrency;
  lanes[lane] = lanes[lane]
    .then(write)
    .catch(cause => {
      const message = cause instanceof Error ? cause.message : String(cause);
      warn(`Failed to write ${what} to ${options?.container ?? 'the pod'}: ${message}`);
      unwritten += 1;
    })
    .finally(() => {
      pending -= 1;
      if (!pending && dropped) {
        warn(`Snapshot queue drained; ${dropped} snapshot(s) were dropped`);
        dropped = 0;
      }
    });
}

/**
 * Wait until everything queued so far has reached the pod, however long that takes.
 *
 * For a producer that can outrun the pod: an order builds its 618 steps in about
 * half a second and the lanes drain into the pod at the pod's pace, so builds run
 * back to back would pile records up past `maxPending` and have the tail dropped.
 * Waiting here is the backpressure that keeps a long run of orders whole.
 *
 * Unbounded, unlike `flushStateSink`, because dropping the records is exactly what
 * the caller is trying to avoid; it still ends, since every write has its own
 * timeout and a lane's chain settles when the last of them does.
 *
 * It says the queue is empty, not that its writes succeeded: whether they did is
 * `unwrittenCount`'s to say.
 */
export async function drainStateSink(): Promise<void> {
  while (pending) {
    await Promise.all(lanes);
  }
}

/**
 * Wait for what is already queued to drain, up to `timeoutMs` — for a shutdown
 * that should not lose snapshots. Work enqueued after the call is not covered,
 * which is the right shape for a shutdown: the lab has stopped answering by then.
 *
 * Bounded, because the pod may be the reason the lab is being stopped: a Ctrl-C
 * that waits on an unreachable host reads as a hang, and a snapshot is not worth
 * that.
 */
export async function flushStateSink(timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  // A loop, not one wait: a run still producing when the signal arrives keeps
  // queueing behind the lanes this call first saw, and one `Promise.all` of those
  // would return with the later records unsent.
  while (pending && Date.now() < deadline) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.all(lanes),
      new Promise<void>(resolve => {
        timer = setTimeout(resolve, Math.max(0, deadline - Date.now()));
      })
    ]);
    clearTimeout(timer);
  }
  if (pending) {
    warn(`Shut down with ${pending} snapshot(s) still unsent`);
  }
}
