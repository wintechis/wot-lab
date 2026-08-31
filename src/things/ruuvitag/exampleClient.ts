import { Servient } from '@node-wot/core';
import httpBinding from '@node-wot/binding-http';
import http from 'http';

const { HttpClientFactory } = httpBinding;
const servient = new Servient();
servient.addClientFactory(new HttpClientFactory(null));

// Helper function to make HTTP requests to the centralized Thing server
function makeHttpRequest(port: number, path: string, method = 'GET', data?: unknown): Promise<unknown> {
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

async function testRuuviTag() {
  try {
    const WoT = await servient.start();
    const td = await WoT.requestThingDescription('http://localhost:8080/ruuvitag');
    const thing = await WoT.consume(td);

    console.log('RuuviTag Test Client');
    console.log('=======================');

    // Subscribe to property changes
    thing.observeProperty('temperature', async (data) => {
      const value = await data.value();
      console.log(`Temperature: ${value}°C`);
    });

    thing.observeProperty('humidity', async (data) => {
      const value = await data.value();
      console.log(`Humidity: ${value}%`);
    });

    thing.observeProperty('pressure', async (data) => {
      const value = await data.value();
      console.log(`Pressure: ${value} Pa`);
    });

    thing.observeProperty('acceleration', async (data) => {
      const value = await data.value();
      if (value && typeof value === 'object' && 'x' in value && 'y' in value && 'z' in value) {
        const accel = value as { x: number; y: number; z: number };
        console.log(`Acceleration: x=${accel.x}, y=${accel.y}, z=${accel.z} mG`);
      } else {
        console.log('Acceleration: Invalid data format');
      }
    });

    thing.observeProperty('movementCounter', async (data) => {
      const value = await data.value();
      console.log(`🚶 Movement Count: ${value}`);
    });

    // Subscribe to events
    thing.subscribeEvent('sensorData', async (data) => {
      const eventData = await data.value();
      console.log(`Sensor Data Event:`, eventData);
    });

    thing.subscribeEvent('movementDetected', async (data) => {
      const eventData = await data.value();
      console.log(`Movement Detected Event:`, eventData);
    });

    // Centralized HTTP server details
    const centralizedHttpPort = 4000;
    const thingId = 'ruuvitag';

    console.log(`\n📱 Centralized HTTP server on port ${centralizedHttpPort}`);
    console.log('=================================');

    // Test sequence
    console.log('\nStarting test sequence...');
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    console.log('\n1. Reading initial sensor data via WoT...');
    const initialTemp = await thing.readProperty('temperature');
    const initialHumidity = await thing.readProperty('humidity');
    const initialPressure = await thing.readProperty('pressure');
    const initialAccel = await thing.readProperty('acceleration');
    
    console.log(`   Temperature: ${await initialTemp.value()}°C`);
    console.log(`   Humidity: ${await initialHumidity.value()}%`);
    console.log(`   Pressure: ${await initialPressure.value()} Pa`);
    console.log(`   Acceleration:`, await initialAccel.value());

    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log('\n2. Testing HTTP simulation endpoints...');
    
    try {
      console.log('   GET /ruuvitag/data (read all sensor data)');
      const currentData = await makeHttpRequest(centralizedHttpPort, `/${thingId}/data`);
      console.log('   HTTP Response:', currentData);
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      console.log('   POST /ruuvitag/simulate (custom temperature and humidity)');
      const simulateResponse = await makeHttpRequest(centralizedHttpPort, `/${thingId}/simulate`, 'POST', {
        temperature: 25.5,
        humidity: 60.0,
        movement: false
      });
      console.log('   HTTP Response:', simulateResponse);
      
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      console.log('   POST /ruuvitag/movement (trigger movement detection)');
      const movementResponse = await makeHttpRequest(centralizedHttpPort, `/${thingId}/movement`, 'POST');
      console.log('   HTTP Response:', movementResponse);
      
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      console.log('   Testing WoT action: simulateReading');
      const actionResult = await thing.invokeAction('simulateReading', {
        temperature: 18.0,
        humidity: 75.0,
        movement: true
      });
      console.log('   WoT Action Result:', actionResult);
      
    } catch (error) {
      console.log(`   ⚠️  HTTP endpoints not available (port ${centralizedHttpPort}):`, (error as Error).message);
      console.log('   This is normal if the Thing hasn\'t fully initialized yet.');
    }

    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log('\n3. Final readings via WoT...');
    const finalTemp = await thing.readProperty('temperature');
    const finalMovementCount = await thing.readProperty('movementCounter');
    const finalSequence = await thing.readProperty('sequenceNumber');
    
    console.log(`   Final temperature: ${await finalTemp.value()}°C`);
    console.log(`   Movement count: ${await finalMovementCount.value()}`);
    console.log(`   Sequence number: ${await finalSequence.value()}`);

    console.log('\n✅ Test completed!');
    console.log('\n📱 You can also test manually:');
    console.log(`   curl http://localhost:${centralizedHttpPort}/${thingId}/data`);
    console.log(`   curl -X POST http://localhost:${centralizedHttpPort}/${thingId}/simulate -H "Content-Type: application/json" -d '{"temperature": 22.5, "humidity": 55, "movement": false}'`);
    console.log(`   curl -X POST http://localhost:${centralizedHttpPort}/${thingId}/movement`);

    console.log('\nKeep this running to see real-time sensor events (updates every 10s)...');

  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : String(error));
    console.log('\n💡 Make sure WoT Lab is running with:');
    console.log('   npm run dev');
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down RuuviTag client...');
  process.exit(0);
});

// Start the test
testRuuviTag();
