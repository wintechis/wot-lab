import { Servient } from '@node-wot/core';
import httpBinding from '@node-wot/binding-http';
import { enable } from 'debug';
import { ThingFactory, ThingCreationResult } from './things/ThingFactory.js';
import { ConfigLoader } from './config/ThingConfig.js';
import { createLoggers } from './utils/debug.js';
import { createEndpointMiddleware } from './http/endpointMiddleware.js';

if (!process.env.DEBUG) {
  enable('wot-lab:system:*');
}

const { debug } = createLoggers('system');

const { HttpServer } = httpBinding;

// Load configuration
const config = await ConfigLoader.getConfiguration();

const servient = new Servient();
const port = config?.global?.wotPort || 8081;
const serverRef: { current?: InstanceType<typeof HttpServer> } = {};
const httpServer = new HttpServer({
  port,
  middleware: createEndpointMiddleware(() => serverRef.current?.getThings() || new Map(), port)
});
serverRef.current = httpServer;
servient.addServer(httpServer);

const wot = await servient.start();
const thingFactory = new ThingFactory(wot);

// Create things based on configuration or auto-discover
let results: ThingCreationResult[];
if (config) {
  debug('Starting WoT Lab with configuration...');
  results = await thingFactory.createConfiguredThings(config);
} else {
  debug('Starting WoT Lab in auto-discovery mode...');
  results = await thingFactory.createAllThings();
}

// Report results
debug('\nThing Creation Summary:');
debug(`Successfully created: ${results.filter(r => r.success).length} Things`);
debug(`Failed to create: ${results.filter(r => !r.success).length} Things`);

if (results.length > 0) {
  const headers = ['Status', 'Thing ID', 'Title', 'Error'];
  const rows = results.map(result => [
    result.success ? 'OK' : 'FAILED',
    result.thingId,
    result.title,
    result.error || ''
  ]);
  const columnWidths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map(row => row[index].length))
  );
  const formatRow = (row: string[]): string =>
    row.map((cell, index) => cell.padEnd(columnWidths[index])).join(' | ');

  debug('\nCreated Things:');
  debug(formatRow(headers));
  debug(columnWidths.map(width => '-'.repeat(width)).join('-+-'));
  rows.forEach(row => debug(formatRow(row)));
}

debug('\nAvailable endpoints:');
debug(`- WoT HTTP server: http://localhost:${port}/`);
debug(`- Thing Descriptions: http://localhost:${port}/{thingId}`);

// Graceful shutdown
process.on('SIGINT', () => {
  debug('\nShutting down gracefully...');
  process.exit(0);
});