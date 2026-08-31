import { Servient } from '@node-wot/core';
import httpBinding from '@node-wot/binding-http';

const { HttpClientFactory } = httpBinding;
const servient = new Servient();
servient.addClientFactory(new HttpClientFactory(null));

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

    // Test sequence
    console.log('\nStarting test sequence...');

    await new Promise(resolve => setTimeout(resolve, 1000));

    console.log('\n1. Reading initial brightness via WoT...');
    const initialBrightness = await thing.readProperty('brightness');
    const initialTimestamp = await thing.readProperty('lastUpdated');
    console.log(`   Initial brightness: ${await initialBrightness.value()} lux`);
    console.log(`   Initial timestamp: ${await initialTimestamp.value()}`);

    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log('\n2. Final brightness reading via WoT...');
    const finalBrightness = await thing.readProperty('brightness');
    console.log(`   Final brightness: ${await finalBrightness.value()} lux`);

    console.log('\n✅ Test completed!');
    console.log('\nKeep this running to see real-time events...');

  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : String(error));
    console.log('\n💡 Make sure WoT Lab is running with:');
    console.log('   bun run dev');
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down client...');
  process.exit(0);
});

// Start the test
testBrightnessSensor();
