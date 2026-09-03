import { Servient } from '@node-wot/core';
import httpBinding from '@node-wot/binding-http';

const { HttpClientFactory } = httpBinding;
const servient = new Servient();
servient.addClientFactory(new HttpClientFactory(null));

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

    // Test sequence
    console.log('\nStarting test sequence...');

    await new Promise(resolve => setTimeout(resolve, 1000));

    console.log('\n1. Reading initial state via WoT...');
    const initialPresence = await thing.readProperty('isPresent');
    const initialCount = await thing.readProperty('detectionCount');
    console.log(`   Initial presence: ${await initialPresence.value()}`);
    console.log(`   Initial count: ${await initialCount.value()}`);

    console.log('\nTest completed!');
    console.log('\nKeep this running to see real-time events...');

  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    console.log('\nMake sure WoT Lab is running with:');
    console.log('   bun run dev');
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down client...');
  process.exit(0);
});

// Start the test
testPresenceSensor();
