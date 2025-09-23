import { Servient } from '@node-wot/core';
import httpBinding from '@node-wot/binding-http';
import { ThingFactory, ThingCreationResult } from './things/ThingFactory.js';
import { StateRestAPI, setGlobalStateRestAPI } from './StateRestAPI.js';
import { ConfigLoader } from './config/ThingConfig.js';
import { createLoggers } from './utils/debug.js';
import { Simulation } from './simulation.js';
import handlers, { time,startTime,speedup } from './simulations/daylight.js';

const { debug } = createLoggers('system');

const { HttpServer } = httpBinding;

// Load configuration
const config = await ConfigLoader.getConfiguration();

const servient = new Servient();
servient.addServer(new HttpServer({ port: config?.global?.wotPort || 8081 }));

const stateRestAPI = new StateRestAPI(config?.global?.apiPort || 3000);
// Set as global instance so things can register their endpoints
setGlobalStateRestAPI(stateRestAPI);

const wot = await servient.start();
const thingFactory = new ThingFactory(wot);

// Create things based on configuration or auto-discover
let results: ThingCreationResult[];
if (config) {
  debug('🚀 Starting WoT Lab with configuration...');
  results = await thingFactory.createConfiguredThings(config);
} else {
  debug('🚀 Starting WoT Lab in auto-discovery mode...');
  results = await thingFactory.createAllThings();
}

console.log(results);

await stateRestAPI.start();

// Report results
debug('\n📊 Thing Creation Summary:');
debug(`✓ Successfully created: ${results.filter(r => r.success).length} Things`);
debug(`❌ Failed to create: ${results.filter(r => !r.success).length} Things`);

if (results.length > 0) {
  debug('\n🔗 Created Thing IDs:');
  results.forEach(result => {
    if (result.success) {
      debug(`  ✓ ${result.thingId} (${result.title})`);
    } else {
      debug(`  ❌ ${result.thingId} (${result.title}) - ${result.error}`);
    }
  });
}

debug('\n🌐 Available endpoints:');
debug('- Simulation API: http://localhost:3000/api/v1/');
debug('- WoT Thing Descriptions: http://localhost:8081/');


const simulation = new Simulation(250, handlers, { time, startTime, speedup });
simulation.start();

// Graceful shutdown
process.on('SIGINT', async () => {
  debug('\n🛑 Shutting down gracefully...');
  await stateRestAPI.stop();
  process.exit(0);
});