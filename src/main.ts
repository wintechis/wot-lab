import { Servient } from '@node-wot/core';
import httpBinding from '@node-wot/binding-http';
import { enable } from 'debug';
import { ThingRegistry } from './things/ThingRegistry.js';
import { setUserModelsDirectory } from './things/ThingHandler.js';
import { loadEnvironmentManifest } from './things/environments.js';
import { parseArgs } from './config/options.js';
import { createLoggers } from './utils/debug.js';
import { createEndpointMiddleware, LabRequestHandler } from './http/endpointMiddleware.js';
import { createLabApi } from './http/labApi.js';

if (!process.env.DEBUG) {
  enable('wot-lab:system:*');
}

const { debug } = createLoggers('system');

const { HttpServer } = httpBinding;

const usage = `wot-lab

  --things <spec>   Things to start, named by Thing Model, e.g. counter:2,lamp
  --env <name>      An environment (a named bundle of fixed-id Things) to start
  --port <number>   HTTP port (default 8081, or WOT_LAB_PORT)
  --models-dir <p>  Where authored Thing Models are written
                    (default: alongside the bundled ones, or WOT_LAB_MODELS_DIR)

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

// Graceful shutdown
process.on('SIGINT', () => {
  debug('\nShutting down gracefully...');
  process.exit(0);
});
