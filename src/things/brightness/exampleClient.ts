import { Servient } from '@node-wot/core';
import httpBinding from '@node-wot/binding-http';
import http from 'http';

const { HttpClientFactory } = httpBinding;
const servient = new Servient();
servient.addClientFactory(new HttpClientFactory(null));

// Helper function to make HTTP requests to the Thing's HTTP server
function makeHttpRequest(port: number, method: string, path: string, data?: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: port,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => {
        responseData += chunk;
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(responseData));
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

async function testBrightnessSensor() {
  try {
    const WoT = await servient.start();
    const td = await WoT.requestThingDescription('http://localhost:8081/brightness');
    const thing = await WoT.consume(td);

    console.log('Brightness Sensor Test Client');
    console.log('=================================');

    // Subscribe to property changes only
    thing.observeProperty('brightness', async (data) => {
      const value = await data.value();
      console.log(`Brightness Level: ${value} lux`);
    });

    thing.observeProperty('lastUpdated', async (data) => {
      const timestamp = await data.value();
      console.log(`Last Updated: ${timestamp}`);
    });

    // Get the simulation API details
    const simulationApiPort = 3000;
    const thingId = 'brightness';

    console.log(`\n💡 Simulation API on port ${simulationApiPort}`);
    console.log('=================================');

    // Test sequence
    console.log('\nStarting test sequence...');
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('\n1. Reading initial brightness via WoT...');
    const initialBrightness = await thing.readProperty('brightness');
    const initialTimestamp = await thing.readProperty('lastUpdated');
    console.log(`   Initial brightness: ${await initialBrightness.value()} lux`);
    console.log(`   Initial timestamp: ${await initialTimestamp.value()}`);

    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log('\n2. Testing HTTP endpoints...');
    
    try {
      console.log('   GET /api/v1/things/brightness/brightness (read current value)');
      const currentValue = await makeHttpRequest(simulationApiPort, 'GET', `/api/v1/things/${thingId}/brightness`);
      console.log('   HTTP Response:', currentValue);
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      console.log('   PUT /api/v1/things/brightness/brightness (set to 1000 lux)');
      const putResponse = await makeHttpRequest(simulationApiPort, 'PUT', `/api/v1/things/${thingId}/brightness`, { brightness: 1000 });
      console.log('   HTTP Response:', putResponse);
      
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      console.log('   POST /api/v1/things/brightness/brightness (set to 2500 lux)');
      const postResponse = await makeHttpRequest(simulationApiPort, 'POST', `/api/v1/things/${thingId}/brightness`, { brightness: 2500 });
      console.log('   HTTP Response:', postResponse);
      
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      console.log('   GET /api/v1/things/brightness/brightness/5000 (set via URL parameter)');
      const urlResponse = await makeHttpRequest(simulationApiPort, 'GET', `/api/v1/things/${thingId}/brightness/5000`);
      console.log('   HTTP Response:', urlResponse);
      
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      console.log('   Testing invalid value (should fail)');
      try {
        const invalidResponse = await makeHttpRequest(simulationApiPort, 'PUT', `/api/v1/things/${thingId}/brightness`, { brightness: -100 });
        console.log('   Unexpected success:', invalidResponse);
      } catch {
        console.log('   ✅ Correctly rejected invalid value');
      }
      
    } catch (error) {
      console.log(`   ⚠️  HTTP endpoints not available (port ${simulationApiPort}):`, (error as Error).message);
      console.log('   This is normal if the Thing hasn\'t fully initialized yet.');
    }

    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log('\n3. Final brightness reading via WoT...');
    const finalBrightness = await thing.readProperty('brightness');
    console.log(`   Final brightness: ${await finalBrightness.value()} lux`);

    console.log('\n✅ Test completed!');
    console.log('\n💡 You can also test manually:');
    console.log(`   curl http://localhost:${simulationApiPort}/api/v1/things/${thingId}/brightness`);
    console.log(`   curl -X PUT http://localhost:${simulationApiPort}/api/v1/things/${thingId}/brightness -H "Content-Type: application/json" -d '{"brightness": 1500}'`);
    console.log(`   curl -X POST http://localhost:${simulationApiPort}/api/v1/things/${thingId}/brightness -H "Content-Type: application/json" -d '{"brightness": 2000}'`);
    console.log(`   curl http://localhost:${simulationApiPort}/api/v1/things/${thingId}/brightness/3000`);

    console.log('\nKeep this running to see real-time events...');

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
testBrightnessSensor();
