import { Servient } from '@node-wot/core';
import httpBinding from '@node-wot/binding-http';
import http from 'http';

const { HttpClientFactory } = httpBinding;
const servient = new Servient();
servient.addClientFactory(new HttpClientFactory(null));

// Helper function to make HTTP requests to the Thing's HTTP server
function makeHttpRequest(port: number, path: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: port,
      path: path,
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.end();
  });
}

async function testPresenceSensor() {
  try {
    const WoT = await servient.start();
    const td = await WoT.requestThingDescription('http://localhost:8081/presence');
    const thing = await WoT.consume(td);

    console.log('Presence Sensor Test Client');
    console.log('==============================');

    // Subscribe to WoT events
    thing.subscribeEvent('presence', async (data) => {
      const eventData = await data.value();
      console.log('WoT PRESENCE EVENT:', eventData);
    });

    thing.subscribeEvent('absence', async (data) => {
      const eventData = await data.value();
      console.log('WoT ABSENCE EVENT:', eventData);
    });

    // Subscribe to property changes
    thing.observeProperty('isPresent', async (data) => {
      const value = await data.value();
      console.log(`Presence Status Changed: ${value ? 'PRESENT' : 'ABSENT'}`);
    });

    thing.observeProperty('detectionCount', async (data) => {
      const count = await data.value();
      console.log(`Detection Count: ${count}`);
    });

    // Get the simulation API details
    const simulationApiPort = 3000;
    const thingId = 'presence';

    console.log(`\nSimulation API on port ${simulationApiPort}`);
    console.log('==============================');

    // Test sequence
    console.log('\nStarting test sequence...');
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('\n1. Reading initial state via WoT...');
    const initialPresence = await thing.readProperty('isPresent');
    const initialCount = await thing.readProperty('detectionCount');
    console.log(`   Initial presence: ${await initialPresence.value()}`);
    console.log(`   Initial count: ${await initialCount.value()}`);

    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log('\n2. Testing HTTP endpoints...');
    
    try {
      console.log('   GET /api/v1/things/presence/status (current state)');
      const status = await makeHttpRequest(simulationApiPort, `/api/v1/things/${thingId}/status`);
      console.log('   HTTP Status:', status);
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      console.log('   GET /api/v1/things/presence/presence (trigger presence)');
      const presenceResponse = await makeHttpRequest(simulationApiPort, `/api/v1/things/${thingId}/presence`);
      console.log('   HTTP Response:', presenceResponse);
      
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      console.log('   GET /api/v1/things/presence/absence (trigger absence)');
      const absenceResponse = await makeHttpRequest(simulationApiPort, `/api/v1/things/${thingId}/absence`);
      console.log('   HTTP Response:', absenceResponse);
      
    } catch (error) {
      console.log(`   ⚠️  HTTP endpoints not available (port ${simulationApiPort}):`, (error as Error).message);
      console.log('   This is normal if the Thing hasn\'t fully initialized yet.');
    }

    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log('\n✅ Test completed!');
    console.log('\n💡 You can also test manually:');
    console.log(`   curl http://localhost:${simulationApiPort}/api/v1/things/${thingId}/presence`);
    console.log(`   curl http://localhost:${simulationApiPort}/api/v1/things/${thingId}/absence`);
    console.log(`   curl http://localhost:${simulationApiPort}/api/v1/things/${thingId}/status`);
    console.log('   curl -X POST http://localhost:8081/presence/actions/triggerPresence');

    console.log('\n🔄 Keep this running to see real-time events...');

  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : String(error));
    console.log('\n💡 Make sure WoT Lab is running with:');
    console.log('   npm run dev');
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down client...');
  process.exit(0);
});

// Start the test
testPresenceSensor();
