import { Parser, Store } from 'n3';
import { globalState, normalizeThingId } from '../globalState.js';
import { EnvTask, PlanStep, loadEnvironmentTasks } from '../things/environments.js';
import { resourceMeta, resourcePrefix } from '../things/resources.js';
import { finishedProductClass } from '../things/resourceTurtle.js';
import { createLoggers } from '../utils/debug.js';
import { SolidFetch } from './dpopFetch.js';
import { agentHeaderName, currentProductIri } from './stateSink.js';

const { debug, info, warn } = createLoggers('solid');

/**
 * Production driven by orders on a Solid pod.
 *
 * A lab pointed at a pod polls one container in it, `orders/`, and builds what it
 * finds there. An order is a Turtle document naming the products a smartphone is
 * to be made of, each by the URI the lab serves it at
 * (`http://localhost:8081/products/661-44796`) — so the thing ordered is named by
 * the thing itself, and an order is readable without knowing anything about this
 * module. Which predicate carries a component does not matter: what makes a URI a
 * component is that it names a product of this lab.
 *
 * Fulfilling an order means running the environment's own plan for the finished
 * product with the ordered products substituted in. The plan comes from the
 * benchmark task that produces one — the same steps the plan scripts fire — and
 * every produce Action now names the products it consumes and the one it builds,
 * which is what makes the substitution possible at all: for each recipe role, the
 * product the order named replaces the one the plan assumed.
 *
 * The steps go out over HTTP to the lab's own port rather than through the
 * servient, because an interaction that did not arrive as a request leaves no
 * provenance record — and the record is the point. Each carries the order's URI as
 * its agent, so the pod's trace of the run says which order caused it.
 *
 * A fulfilled order is marked as such on the pod, so a restart does not build it
 * again.
 */

export interface OrderRunnerOptions {
  /** The container `--solid-container` names; `orders/` sits inside it. Ends in a slash. */
  container: string;
  /** Where this lab is served, e.g. `http://localhost:8081` — its products and its Actions. */
  labBaseUrl: string;
  /** How the pod is reached; the global `fetch` when a pod wants no credentials. */
  fetch?: SolidFetch;
  /** Milliseconds between sweeps of the orders container. */
  intervalMs: number;
  /** The environment running now, which is where the plan comes from. */
  // eslint-disable-next-line no-unused-vars
  environment: () => string | undefined;
  /**
   * Put every Thing back to its initial state.
   *
   * An order consumes raw materials, so without this only the first order of a
   * session could be built: the second would find the floor empty and every
   * recipe would decline. The records of the orders before it are already in the
   * pod, so resetting loses nothing that was recorded.
   */
  reset: () => void;
}

/** The predicate and object a fulfilled order carries. */
const fulfilledPredicate = 'https://example.org/passport/fulfilled';
const trueLiteral = '"true"^^<http://www.w3.org/2001/XMLSchema#boolean>';

/**
 * The predicate a fulfilled order names what was made for it with.
 *
 * The copy in the pod, not the lab's `/products/<id>`: the lab serves the product
 * of whichever run made one last, so a link there would come to mean a different
 * phone as soon as the next order was built. The pod's copy belongs to this
 * order's run and keeps saying what this order produced.
 */
const productPredicate = 'https://example.org/passport/product';

const ldpContains = 'http://www.w3.org/ns/ldp#contains';

// Long enough for a pod on a slow link, short enough that a black-holed
// connection cannot stall the poll loop indefinitely.
const requestTimeoutMs = 10_000;

let options: OrderRunnerOptions | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
// Orders this process has finished with: fulfilled, or attempted and failed. The
// pod carries the first of those as well, which is what survives a restart; this
// also holds the failures, so a plan that cannot be run is not retried every few
// seconds for the life of the lab.
const settled = new Set<string>();
// Documents in the container that are not orders. Re-read every sweep, because an
// order with a typo in it — a product URI on the wrong port, say — is a document
// someone will fix in place, and one the lab had written off for good would then
// stay written off. Remembered only so the reason is said once rather than every
// few seconds.
const notOrders = new Set<string>();
// Orders built in this process whose triples are not on the pod yet. A pod that
// refused the write — it was busy, or the container grants append but not write —
// must not cost a rebuild: the order is built, `settled` says so, and only the
// marking is retried. What to write is worked out when the order is built and
// kept, because by the time a retry runs the next order may have begun a run of
// its own, and the products of this one are in the run that made them.
const unmarked = new Map<string, Fulfilment>();

/** What a built order has still to be told about itself. */
interface Fulfilment {
  /** The subject the triples are said about — the order as it names itself. */
  subject: string;
  /** Where the pod holds what the order produced. */
  products: string[];
}
// The last failure reported for an order, so a pod that keeps refusing the same
// request is reported once instead of every few seconds.
const lastFailure = new Map<string, string>();
// Said once rather than once per sweep: a lab with no environment loaded would
// otherwise repeat it for as long as it is up.
let warnedWithoutPlan = false;

/** Where orders are read from, inside the container the lab was pointed at. */
export function ordersContainer(container: string): string {
  return `${container}orders/`;
}

/**
 * Start polling. Nothing happens until an order appears, so a lab configured only
 * to write traces is unaffected by this being on.
 */
export function startOrderRunner(next: OrderRunnerOptions): void {
  options = next;
  debug(`Polling ${ordersContainer(next.container)} every ${next.intervalMs}ms for orders`);
  // The container is created rather than waited for, so an operator can see where
  // an order goes without having to make the container first.
  void ensureOrdersContainer(next).then(() => schedule());
}

export function stopOrderRunner(): void {
  clearTimeout(timer);
  timer = undefined;
  options = undefined;
}

function schedule(): void {
  if (!options) {
    return;
  }
  timer = setTimeout(() => {
    void sweep().finally(schedule);
  }, options.intervalMs);
}

/** PUT the orders container, once at startup, the way the state sink makes its own. */
async function ensureOrdersContainer(sink: OrderRunnerOptions): Promise<void> {
  const container = ordersContainer(sink.container);
  try {
    const response = await send(sink, container, {
      method: 'PUT',
      headers: {
        'Content-Type': 'text/turtle',
        Link: '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"'
      },
      body: ''
    });
    // A pod that already has it answers 200/204/205, or 409/412 to say so.
    if (!response.ok && response.status !== 409 && response.status !== 412) {
      warn(`Pod refused the orders container ${container}: ${response.status} ${response.statusText}`);
      return;
    }
    debug(`Orders container ${container} ready (${response.status})`);
  } catch (cause) {
    warn(`Could not create the orders container ${container}: ${message(cause)}`);
  }
}

/** One pass over the container: read every order, build the ones not yet built. */
async function sweep(): Promise<void> {
  const sink = options;
  if (!sink) {
    return;
  }
  let listing: Store;
  try {
    listing = await read(sink, ordersContainer(sink.container));
  } catch (cause) {
    warn(`Could not read ${ordersContainer(sink.container)}: ${message(cause)}`);
    return;
  }

  // Sorted, so a container holding several new orders is built in a defined
  // order rather than whichever the pod happened to list first.
  const members = listing
    .getObjects(null, ldpContains, null)
    .map(object => object.value)
    .filter(iri => !iri.endsWith('/'))
    .sort();

  for (const iri of members) {
    // Built already, and only the pod does not know it yet.
    if (unmarked.has(iri)) {
      await markFulfilled(sink, iri, unmarked.get(iri) as Fulfilment);
      continue;
    }
    if (settled.has(iri)) {
      continue;
    }
    try {
      await consider(sink, iri);
    } catch (cause) {
      // Reading an order can fail for reasons that have nothing to do with the
      // order: a pod still digesting the hundreds of records the last one
      // produced, a token being renewed, a timeout. None of those is a verdict
      // on the order, so it is left for the next sweep rather than written off —
      // only an order whose plan has actually run is settled, in `build`.
      report(iri, `could not be read: ${message(cause)}`);
    }
  }
}

/** Report an order's failure once, however many sweeps it goes on failing for. */
function report(iri: string, detail: string): void {
  if (lastFailure.get(iri) === detail) {
    return;
  }
  lastFailure.set(iri, detail);
  warn(`Order ${iri} ${detail}; trying again on the next sweep`);
}

/** Read one member and build it, unless it is not an order or is already fulfilled. */
async function consider(sink: OrderRunnerOptions, iri: string): Promise<void> {
  const order = await read(sink, iri);
  // The read worked, so whatever it last failed with is no longer the state of
  // things. Only a read failure is forgotten here: a marking that was refused is
  // held by `unmarked`, which never reaches this far.
  lastFailure.delete(iri);
  if (order.countQuads(null, fulfilledPredicate, null, null) > 0) {
    debug(`Order ${iri} is already fulfilled`);
    settled.add(iri);
    return;
  }

  const components = componentsOf(sink, order);
  if (!components.ids.length) {
    // Not every document in the container need be an order — a README, a
    // listing's own description. One that names no product is not one to build.
    if (!notOrders.has(iri)) {
      debug(`${iri} names no product of this lab; not an order`);
      notOrders.add(iri);
    }
    return;
  }
  notOrders.delete(iri);

  await build(sink, iri, components);
}

/**
 * The products an order names, and the subject that names them.
 *
 * Any object URI that is one of this lab's products counts, whatever predicate
 * carried it, so an order written with `schema:orderedItem`, `ex:input` or a term
 * of its own all read the same. The subject is remembered because that is what
 * the fulfilled triple is said about: the order as the order itself names it,
 * rather than the document it arrived in.
 */
function componentsOf(sink: OrderRunnerOptions, order: Store): { subject?: string; ids: string[] } {
  const prefix = `${sink.labBaseUrl}/${resourcePrefix}/`;
  const ids: string[] = [];
  let subject: string | undefined;
  for (const quad of order) {
    if (quad.object.termType !== 'NamedNode' || !quad.object.value.startsWith(prefix)) {
      continue;
    }
    // `.../products/cpu` and `.../products/cpu#product` name the same product:
    // the second is how a product's own representation links its parts.
    const segment = quad.object.value.slice(prefix.length).split('#')[0];
    const id = normalizeThingId(decodeURIComponent(segment));
    if (!segment || ids.includes(id)) {
      continue;
    }
    ids.push(id);
    subject ??= quad.subject.value;
  }
  return { subject, ids };
}

/** Run the environment's plan for a finished product, with the order's products in it. */
async function build(
  sink: OrderRunnerOptions,
  iri: string,
  components: { subject?: string; ids: string[] }
): Promise<void> {
  const environment = sink.environment();
  const task = environment ? await planFor(environment) : undefined;
  if (!task) {
    if (!warnedWithoutPlan) {
      warn(
        environment
          ? `Environment '${environment}' has no plan that produces a finished product; orders cannot be built`
          : 'No environment is running; orders cannot be built'
      );
      warnedWithoutPlan = true;
    }
    return;
  }
  warnedWithoutPlan = false;

  const choice = await substitutions(sink, task.optimalPlan, new Set(components.ids));
  const unused = components.ids.filter(id => !choice.matched.has(id));
  if (unused.length) {
    warn(`Order ${iri} names ${unused.join(', ')}, which no recipe of '${environment}' uses`);
  }

  const started = Date.now();
  info(`Order started: ${iri} — running ${task.optimalPlan.length} step(s) of '${environment}' task ${task.id} with ${describe(choice)}`);
  sink.reset();
  for (const step of task.optimalPlan) {
    await invoke(sink, iri, { ...step, input: substitute(step.input, choice.replacing) });
  }

  // The plan has run, so the order is settled whatever came of it: a plan that
  // leaves no product is one that would leave none the next time either, and
  // retrying it every few seconds would be hundreds of invocations a minute.
  settled.add(iri);
  const seconds = ((Date.now() - started) / 1_000).toFixed(1);
  const produced = goalProducts(task, choice.replacing);
  const missing = produced.filter(id => (globalState.things as Record<string, Record<string, unknown>>)[id]?.state !== 'initialState');
  if (missing.length) {
    warn(`Order ${iri} ran ${task.optimalPlan.length} step(s) in ${seconds}s but ${missing.join(', ')} was not produced; not marked fulfilled`);
    return;
  }
  const fulfilment: Fulfilment = {
    subject: components.subject ?? iri,
    // Where the pod will hold them. Written from the same interaction that made
    // them, behind the response, so the document may land a moment after the
    // order says it exists — the same way a record naming a product it generated
    // can name one not written yet.
    products: produced.map(currentProductIri).filter((product): product is string => product !== undefined)
  };
  info(`Order processed: ${iri} — produced ${fulfilment.products.join(', ') || produced.join(', ')} in ${seconds}s`);
  unmarked.set(iri, fulfilment);
  await markFulfilled(sink, iri, fulfilment);
}

/**
 * The plan an order is built by: the environment's task that puts a finished
 * product on the floor, the longest of them if several do.
 *
 * Taken from the tasks rather than written here, because the plan is already data
 * the environment ships — the same steps the benchmark scores and the plan scripts
 * fire. Which task that is comes from the goal and the products' own classes, so
 * no task id is hard-coded.
 */
async function planFor(environment: string): Promise<EnvTask | undefined> {
  const tasks = await loadEnvironmentTasks(environment).catch(() => []);
  return tasks
    .filter(task => task.optimalPlan?.length && task.goal.some(isFinishedProduct))
    .sort((a, b) => b.optimalPlan.length - a.optimalPlan.length)[0];
}

/** Whether a goal predicate asks for a finished product to exist. */
function isFinishedProduct(goal: { thing: string; property: string; op: string; value: unknown }): boolean {
  return goal.property === 'state'
    && goal.op === '='
    && goal.value === 'initialState'
    && Boolean(resourceMeta(normalizeThingId(goal.thing))?.types.includes(finishedProductClass));
}

/** The finished products the plan is expected to leave, under the order's substitutions. */
function goalProducts(task: EnvTask, chosen: Map<string, string>): string[] {
  return task.goal
    .filter(isFinishedProduct)
    .map(goal => normalizeThingId(goal.thing))
    .map(id => chosen.get(id) ?? id);
}

/**
 * Which product the plan's product is replaced by, for every role the order
 * spoke about.
 *
 * A recipe role's `enum` is the set of products that can play it — `battery`, or
 * any of the battery spare parts — so a role the order named a member of is a role
 * whose product the order chose. Every other member of that role maps to it,
 * which covers the plan's produce steps and the transporter's `pickup` alike:
 * both name a product by the same id.
 *
 * The enums come from the Thing Descriptions the lab serves, so this follows
 * whatever the stations currently declare rather than a second copy of it.
 */
async function substitutions(
  sink: OrderRunnerOptions,
  plan: PlanStep[],
  components: Set<string>
): Promise<Choice> {
  const choice: Choice = { replacing: new Map(), matched: new Set() };
  for (const [role, candidates] of await roles(sink, plan)) {
    const named = candidates.filter(id => components.has(id));
    if (!named.length) {
      continue;
    }
    if (named.length > 1) {
      warn(`An order names ${named.join(' and ')} for the '${role}' role; using ${named[0]}`);
    }
    choice.matched.add(named[0]);
    for (const candidate of candidates) {
      if (candidate !== named[0]) {
        choice.replacing.set(candidate, named[0]);
      }
    }
  }
  return choice;
}

/**
 * What an order's products come to.
 *
 * `matched` holds the ordered products a recipe role accepted, including one that
 * is already the product the plan used: it substitutes nothing, and is still a
 * component the order was right to name.
 */
interface Choice {
  /** The plan's product -> the product the order named in its place. */
  replacing: Map<string, string>;
  /** The ordered products a recipe role accepted. */
  matched: Set<string>;
}

/** Every recipe role the plan's produce Actions declare, and the products that can play it. */
async function roles(sink: OrderRunnerOptions, plan: PlanStep[]): Promise<Map<string, string[]>> {
  const found = new Map<string, string[]>();
  const descriptions = new Map<string, ThingDescription>();
  for (const step of plan) {
    if (!descriptions.has(step.thing)) {
      descriptions.set(step.thing, await describeThing(sink, step.thing));
    }
    const properties = descriptions.get(step.thing)?.actions?.[step.action]?.input?.properties ?? {};
    for (const [role, schema] of Object.entries(properties)) {
      // `trigger` is the Action's confirmation, not a product; a role's schema
      // lists the products that can play it.
      if (Array.isArray(schema?.enum) && schema.enum.every(value => typeof value === 'string')) {
        found.set(role, schema.enum as string[]);
      }
    }
  }
  // The trigger looks like a role by shape — a string with an enum — and is told
  // apart by what it names: `produceIt` is no product of this lab.
  for (const [role, candidates] of found) {
    if (!candidates.some(id => resourceMeta(normalizeThingId(id)))) {
      found.delete(role);
    }
  }
  return found;
}

interface ThingDescription {
  actions?: Record<string, { input?: { properties?: Record<string, { enum?: unknown[] }> } }>;
}

/** One Thing's description, as the lab serves it. */
async function describeThing(sink: OrderRunnerOptions, id: string): Promise<ThingDescription> {
  const response = await fetch(`${sink.labBaseUrl}/${encodeURIComponent(id)}`, {
    headers: { Accept: 'application/td+json, application/json' },
    signal: AbortSignal.timeout(requestTimeoutMs)
  });
  if (!response.ok) {
    throw new Error(`Could not read the Thing Description of '${id}': ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as ThingDescription;
}

/** The products the order asked for, for the log. */
function describe(choice: Choice): string {
  return choice.matched.size ? [...choice.matched].join(', ') : 'the products the plan itself uses';
}

/** One step's input with every product the order chose put in place of the plan's. */
function substitute(input: unknown, chosen: Map<string, string>): unknown {
  if (typeof input === 'string') {
    return chosen.get(input) ?? input;
  }
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    return Object.fromEntries(
      Object.entries(input as Record<string, unknown>).map(([name, value]) => [name, substitute(value, chosen)])
    );
  }
  return input;
}

/**
 * Invoke one Action over the lab's own HTTP port.
 *
 * The body follows the shape of the input, as a client would send it: an object
 * input is JSON, a scalar is the bare value as text, and an Action with no input
 * gets no body at all. A step that fails does not stop the plan — a recipe whose
 * inputs are not in place answers `success: false` with a 200, and the check after
 * the plan is what says whether the order was built.
 */
async function invoke(sink: OrderRunnerOptions, order: string, step: PlanStep): Promise<void> {
  const url = `${sink.labBaseUrl}/${encodeURIComponent(step.thing)}/actions/${encodeURIComponent(step.action)}`;
  const { headers, body } = request(step.input);
  try {
    const response = await fetch(url, {
      method: 'POST',
      // The order is the agent: a record of this interaction then says which
      // order asked for it, and the pod's trace of the run reads back as the
      // order being filled.
      headers: { ...headers, [agentHeaderName()]: order },
      body,
      signal: AbortSignal.timeout(requestTimeoutMs)
    });
    if (!response.ok) {
      warn(`${step.thing}/${step.action} answered ${response.status} ${response.statusText}`);
    }
  } catch (cause) {
    warn(`${step.thing}/${step.action} failed: ${message(cause)}`);
  }
}

function request(input: unknown): { headers: Record<string, string>; body?: string } {
  if (input !== null && typeof input === 'object') {
    return Object.keys(input as object).length
      ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }
      : { headers: { 'Content-Length': '0' } };
  }
  if (input === undefined || input === null) {
    return { headers: { 'Content-Length': '0' } };
  }
  return { headers: { 'Content-Type': 'text/plain' }, body: String(input) };
}

/**
 * Say on the pod that an order has been built.
 *
 * A `PATCH` rather than a `PUT`, so the order document keeps the form it was
 * written in — its comments, its prefixes, its layout — and gains one triple. A
 * pod that will not take a SPARQL update is read and written back instead, which
 * costs the formatting but still records the fact.
 */
async function markFulfilled(sink: OrderRunnerOptions, iri: string, fulfilment: Fulfilment): Promise<void> {
  const { subject, products } = fulfilment;
  const triples = [
    `<${subject}> <${fulfilledPredicate}> ${trueLiteral} .`,
    ...products.map(product => `<${subject}> <${productPredicate}> <${product}> .`)
  ].join('\n');
  try {
    const patched = await send(sink, iri, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/sparql-update' },
      body: `INSERT DATA {\n${triples}\n}`
    });
    if (patched.ok) {
      marked(iri);
      return;
    }
    debug(`Pod would not PATCH ${iri} (${patched.status}); writing it back instead`);
    const current = await send(sink, iri, { method: 'GET', headers: { Accept: 'text/turtle' } });
    if (!current.ok) {
      report(iri, `could not be re-read to be marked fulfilled: ${current.status} ${current.statusText}`);
      return;
    }
    const put = await send(sink, iri, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/turtle' },
      body: `${await current.text()}\n${triples}\n`
    });
    if (!put.ok) {
      report(iri, `could not be marked fulfilled: ${put.status} ${put.statusText} (a container that grants append but not write cannot take the triple)`);
      return;
    }
    marked(iri);
  } catch (cause) {
    report(iri, `could not be marked fulfilled: ${message(cause)}`);
  }
}

/** The pod now carries the triple, so neither the marking nor the build is owed. */
function marked(iri: string): void {
  unmarked.delete(iri);
  lastFailure.delete(iri);
  debug(`Marked ${iri} fulfilled`);
}

/** One pod resource, parsed, with its own URI as the base for relative terms. */
async function read(sink: OrderRunnerOptions, iri: string): Promise<Store> {
  const response = await send(sink, iri, { method: 'GET', headers: { Accept: 'text/turtle' } });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return new Store(new Parser({ baseIRI: iri }).parse(await response.text()));
}

function send(sink: OrderRunnerOptions, url: string, init: RequestInit): Promise<Response> {
  return (sink.fetch ?? fetch)(url, { ...init, signal: AbortSignal.timeout(requestTimeoutMs) });
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
