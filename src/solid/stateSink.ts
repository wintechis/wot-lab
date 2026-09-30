import { globalState, normalizeThingId } from '../globalState.js';
import { createLoggers } from '../utils/debug.js';
import { Interaction, provenanceToTurtle, StateSnapshot, ThingState } from './stateResource.js';

const { debug, warn } = createLoggers('solid');

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * The header a client names itself in, lowercased as Node presents headers.
 *
 * A header rather than anything cleverer because the client of a WoT lab is
 * usually a script: one line of curl is the whole cost of appearing in the log
 * as yourself instead of as an address.
 */
export const defaultAgentHeader = 'x-agent';

export interface StateSinkOptions {
  /** The LDP container every record is POSTed to. Always ends in a slash. */
  container: string;
  /** Where this lab's Things are served from, e.g. `http://localhost:8081`. */
  thingBaseUrl: string;
  /** The header naming the requesting agent; `defaultAgentHeader` when unset. */
  agentHeader?: string;
  /** The environment currently running, read at post time rather than captured. */
  // eslint-disable-next-line no-unused-vars
  environment?: () => string | undefined;
}

// A pod is a remote server on the far side of a network, so posting is never in
// the request's path: snapshots queue here and drain behind the response.
//
// The queue is bounded because it is fed by inbound traffic it cannot slow down.
// A pod that stops answering would otherwise turn every further interaction into
// retained memory; past this many waiting snapshots the lab drops them and says
// so, which is the right failure for an observer that must not perturb what it
// observes.
const maxPending = 256;

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
const lanes: Promise<void>[] = Array.from({ length: concurrency }, () => Promise.resolve());
let nextLane = 0;
let dropped = 0;

/**
 * Point the sink at a container. Without this call nothing is posted, which is
 * what makes the feature opt-in: no container configured, no outbound traffic.
 */
export function configureStateSink(next: StateSinkOptions): void {
  options = next;
  debug(`Posting Thing state to ${next.container}`);
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

function thingIri(sink: StateSinkOptions, id: string): string {
  return `${sink.thingBaseUrl}/${encodeURIComponent(id)}`;
}

/**
 * Every running Thing's state, in creation order.
 *
 * The whole environment rather than the addressed Thing alone, because a WoT
 * interaction is not confined to the Thing it names: a cross-Thing VRE effect
 * changes others, and those changes belong to the interaction that caused them.
 * The cost is one record's size — a record now grows with the environment — and
 * it is paid once per interaction, off the request's path.
 */
function everyThingState(sink: StateSinkOptions): ThingState[] {
  const things = globalState.things as Record<string, Record<string, unknown>>;
  return Object.keys(things).map(id => ({
    id,
    iri: thingIri(sink, id),
    state: clone(things[id])
  }));
}

async function post(snapshot: StateSnapshot, container: string): Promise<void> {
  const body = provenanceToTurtle(snapshot);
  const response = await fetch(container, {
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
    return;
  }

  // 201 carries the URI the pod minted; a container that answers 200/204 gives
  // none, and there is nothing to report then.
  const location = response.headers.get('location');
  debug(`Posted state of '${snapshot.interaction.thingId}'${location ? ` as ${new URL(location, container).href}` : ''}`);
}

/**
 * Publish the provenance of one WoT interaction.
 *
 * Returns immediately: the caller is an HTTP handler, and a pod's latency is not
 * the client's problem. Nothing here can throw into the request — a pod that is
 * down or slow costs a warning and nothing else.
 */
export function publishThingState(interaction: Interaction): void {
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
    // One line per backlog, not one per drop: the pod being unreachable would
    // otherwise be as noisy as the traffic it is failing to record.
    if (dropped === 1 || dropped % 100 === 0) {
      warn(`Snapshot queue full (${maxPending}); dropped ${dropped} snapshot(s) so far`);
    }
    return;
  }

  const snapshot: StateSnapshot = {
    interaction: { ...interaction, thingId: id },
    thingIri: thingIri(sink, id),
    environment: sink.environment?.(),
    // Read now, not when the POST runs: by then the next interaction may have
    // changed it, and this resource claims to be the state *this* request left.
    // Serialising through JSON also flattens the Valtio proxies the Things' own
    // handlers serve, which is what the rest of the lab does to detach state.
    things: everyThingState(sink)
  };

  pending += 1;
  const lane = nextLane;
  nextLane = (nextLane + 1) % concurrency;
  lanes[lane] = lanes[lane]
    .then(() => post(snapshot, sink.container))
    .catch(cause => {
      const message = cause instanceof Error ? cause.message : String(cause);
      warn(`Failed to post state of '${id}' to ${sink.container}: ${message}`);
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
 * Wait for what is already queued to drain, up to `timeoutMs` — for a shutdown
 * that should not lose snapshots. Work enqueued after the call is not covered,
 * which is the right shape for a shutdown: the lab has stopped answering by then.
 *
 * Bounded, because the pod may be the reason the lab is being stopped: a Ctrl-C
 * that waits on an unreachable host reads as a hang, and a snapshot is not worth
 * that.
 */
export async function flushStateSink(timeoutMs = 2_000): Promise<void> {
  if (!pending) {
    return;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.all(lanes),
    new Promise<void>(resolve => {
      timer = setTimeout(resolve, timeoutMs);
    })
  ]);
  clearTimeout(timer);
  if (pending) {
    warn(`Shut down with ${pending} snapshot(s) still unsent`);
  }
}
