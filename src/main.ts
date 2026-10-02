import { Servient } from '@node-wot/core';
import httpBinding from '@node-wot/binding-http';
import { enable } from 'debug';
import { ThingRegistry } from './things/ThingRegistry.js';
import { setUserModelsDirectory } from './things/ThingHandler.js';
import { loadEnvironmentManifest } from './things/environments.js';
import { defaultOrdersPollSeconds, parseArgs } from './config/options.js';
import { createLoggers } from './utils/debug.js';
import { createEndpointMiddleware, LabRequestHandler } from './http/endpointMiddleware.js';
import { createLabApi, labPrefix } from './http/labApi.js';
import { configureStateSink, flushStateSink } from './solid/stateSink.js';
import { buildSerial, productsContainerIn, startSerials } from './solid/serials.js';
import { ordersContainer, startOrderRunner, stopOrderRunner } from './solid/orders.js';
import { createDpopFetch } from './solid/dpopFetch.js';

if (!process.env.DEBUG) {
  // The Solid sink's warnings too: a dropped or refused provenance record is
  // data lost from a run, and must not go unnoticed for want of a DEBUG flag.
  // And its info lines, which are where an order the pod placed says that it
  // started and that it was built — a production run the lab began by itself is
  // not something to find out about only by setting a flag.
  enable('wot-lab:system:*,wot-lab:solid:info,wot-lab:solid:warn');
}

const { debug } = createLoggers('system');

const { HttpServer } = httpBinding;

const usage = `wot-lab

  --things <spec>   Things to start, named by Thing Model, e.g. counter:2,lamp
  --env <name>      An environment (a named bundle of fixed-id Things) to start
  --port <number>   HTTP port (default 8081, or WOT_LAB_PORT)
  --models-dir <p>  Where authored Thing Models are written
                    (default: alongside the bundled ones, or WOT_LAB_MODELS_DIR)
  --solid-container <url>
                    An LDP container (a Solid pod's) the lab writes into:
                    traces/ gets a PROV-O record of every WoT interaction — the
                    request, the activity and the Thing state it left behind —
                    and products/ every finished product with the products it
                    links (or WOT_LAB_SOLID_CONTAINER). Unset posts nothing.
  --solid-client-id <id> --solid-client-secret <secret>
                    A client credentials token from the Solid server's account
                    page (or WOT_LAB_SOLID_CLIENT_ID / _SECRET). Given, records
                    are posted with Solid-OIDC as that token's WebID; unset, they
                    are posted as the public.
  --agent-header <name>
                    The request header a client names itself in, reported as the
                    activity's agent (default x-agent, or WOT_LAB_AGENT_HEADER).
                    A request naming none is attributed to its address.
  --orders-poll <seconds>
                    How often the pod's orders/ container is read, which the lab
                    builds what it finds in (default 5, or WOT_LAB_ORDERS_POLL).
                    0 leaves orders unread.

Starting without --things is normal: Things are created from the dashboard.`;

let options;
try {
  options = parseArgs();
} catch (error) {
  console.error(`ERROR: ${(error as Error).message}\n\n${usage}`);
  process.exit(1);
}

// Set before anything reads the catalog: it decides which roots a Thing Model
// can be found in, and where a newly authored one is written.
setUserModelsDirectory(options.modelsDir);

const servient = new Servient();
const serverRef: { current?: InstanceType<typeof HttpServer> } = {};
// The middleware is built before the servient starts, but the lab API needs the
// running servient, so it is reached through a ref that is filled in below.
const labRef: { current?: LabRequestHandler } = {};
const httpServer = new HttpServer({
  port: options.port,
  middleware: createEndpointMiddleware(
    () => serverRef.current?.getThings() || new Map(),
    options.port,
    () => labRef.current
  )
});
serverRef.current = httpServer;
servient.addServer(httpServer);

const wot = await servient.start();
const registry = new ThingRegistry(wot, servient);
labRef.current = createLabApi(registry);

// Configured after the registry exists, because a record links to the environment
// running when it was taken, and only the registry knows which that is. Left
// unconfigured without a container, so the default lab makes no outbound requests.
if (options.solidContainer) {
  const baseUrl = `http://localhost:${options.port}`;
  const environmentUri = (): string | undefined => {
    const environment = registry.environment();
    return environment
      ? `${baseUrl}/${labPrefix}/environments/${encodeURIComponent(environment)}`
      : undefined;
  };
  // The pod's own origin issues the tokens: a Community Solid Server is the
  // identity provider for the pods it serves. Unset credentials leave this
  // undefined and the sink falls back to a plain `fetch`, which is what an open
  // container wants.
  const podFetch = options.solidClientId && options.solidClientSecret
    ? createDpopFetch({
      server: new URL(options.solidContainer).origin,
      clientId: options.solidClientId,
      clientSecret: options.solidClientSecret
    })
    : undefined;
  // Before the sink takes a single record, because the first build of this session
  // must not be given a serial the pod already holds — that container's traces and
  // products would be overwritten. Awaited for the same reason: a serial is handed
  // out synchronously when a run begins, so the count has to be right by then.
  await startSerials(productsContainerIn(options.solidContainer), podFetch);
  configureStateSink({
    container: options.solidContainer,
    thingBaseUrl: baseUrl,
    fetch: podFetch,
    agentHeader: options.agentHeader,
    environmentIri: () => environmentUri(),
    // The run rather than the environment: the same manifest loaded twice is the
    // same environment, so records grouped only by that read two runs as one
    // sequence — and a restart as a change the next request caused. A name, which
    // the sink turns into the container a run's records live in.
    //
    // The name is the serial of what the run builds, and the moment the run began
    // is only how one run is told from the next — a reader with a phone in hand
    // can find its history from the number on its back, which the moment it was
    // made would not have told them. Allocated on demand, so a lab with no
    // environment running numbers nothing.
    runId: () => (registry.environment() ? buildSerial(registry.environmentStartedAt()) : undefined)
  });

  // The same container is read for orders. Nothing is built unless someone puts
  // an order in it, so a lab configured only to write records is unaffected.
  const pollSeconds = options.ordersPollSeconds ?? defaultOrdersPollSeconds;
  if (pollSeconds > 0) {
    startOrderRunner({
      container: options.solidContainer,
      labBaseUrl: baseUrl,
      fetch: podFetch,
      intervalMs: pollSeconds * 1000,
      environment: () => registry.environment(),
      // An order consumes raw materials, so each one starts from the environment's
      // initial conditions — the same reset the benchmark takes between runs.
      reset: () => {
        registry.resetAll();
      }
    });
  }
}

// Nothing is created implicitly. A Thing exists because the command line asked
// for it or because someone created it in the dashboard — one way in, through
// the registry. An environment is the same registry driven from a manifest,
// pinning ids instead of allocating them so a scenario's cross-Thing references
// resolve the same way every run.
const things = await registry.instantiateAll(options.things);
if (options.env) {
  try {
    const manifest = await loadEnvironmentManifest(options.env);
    things.push(...(await registry.instantiateEnvironment(manifest)));
  } catch (cause) {
    debug(`Failed to start environment '${options.env}':`, cause);
  }
}

if (things.length > 0) {
  const headers = ['Thing ID', 'Thing Model', 'Title'];
  const rows = things.map(thing => [thing.id, thing.model, thing.title]);
  const columnWidths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map(row => row[index].length))
  );
  const formatRow = (row: string[]): string =>
    row.map((cell, index) => cell.padEnd(columnWidths[index])).join(' | ');

  debug(`\nExposed ${things.length} Thing(s):`);
  debug(formatRow(headers));
  debug(columnWidths.map(width => '-'.repeat(width)).join('-+-'));
  rows.forEach(row => debug(formatRow(row)));
} else {
  const models = await registry.listModels();
  debug(`\nNo Things started. ${models.length} Thing Model(s) available: ${models.map(model => model.name).join(', ')}`);
  debug('Create a Thing in the dashboard, or start some with --things <model>[:count].');
}

debug('\nAvailable endpoints:');
debug(`- Dashboard:           http://localhost:${options.port}/`);
debug(`- Thing Descriptions:  http://localhost:${options.port}/{thingId}`);
debug(`- Lab API:             http://localhost:${options.port}/_lab/thing-models`);
if (options.modelsDir) {
  debug(`- Authored models:     ${options.modelsDir}`);
}
if (options.solidContainer) {
  const as = options.solidClientId ? ` (as client '${options.solidClientId}')` : ' (unauthenticated)';
  debug(`- Provenance records:  POST ${options.solidContainer}${as}`);
  const pollSeconds = options.ordersPollSeconds ?? defaultOrdersPollSeconds;
  if (pollSeconds > 0) {
    debug(`- Orders:              GET ${ordersContainer(options.solidContainer)} every ${pollSeconds}s`);
  }
}

// Graceful shutdown. SIGINT is Ctrl-C at a prompt; SIGTERM is what `systemctl stop`,
// `systemctl restart` and so every deploy send. Both must flush, or a deploy that
// lands while a run is still draining throws the queued records away.
let shuttingDown = false;
function shutdown(signal: string, flushMs: number): void {
  // A second signal is someone who has stopped waiting.
  if (shuttingDown) {
    process.exit(1);
  }
  shuttingDown = true;
  debug(`\n${signal}: shutting down gracefully...`);
  // Before the flush, so a sweep cannot start another production run while the
  // records of the last one are draining.
  stopOrderRunner();
  // Snapshots already queued are in flight to the pod; losing them would leave
  // its record of the session ending before the session did. Bounded, because a
  // pod that has stopped answering must not turn a stop into a hang.
  void flushStateSink(flushMs).finally(() => process.exit(0));
}
// Briefly at a prompt, where Ctrl-C reading as a hang is the worse failure.
process.on('SIGINT', () => shutdown('SIGINT', 2_000));
// Longer under a supervisor, which waits (systemd: 90 s by default) and for which
// a half-written run is the worse failure.
process.on('SIGTERM', () => shutdown('SIGTERM', 15_000));
