import { Servient } from '@node-wot/core';
import httpBinding from '@node-wot/binding-http';
import http from 'http';

interface RGBColor {
  R: number;
  G: number;
  B: number;
}

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

async function testBLERGBController() {
  try {
    const WoT = await servient.start();
    const td = await WoT.requestThingDescription('http://localhost:8081/blergb');
    const thing = await WoT.consume(td);

    console.log('BLE RGB Controller Test Client');
    console.log('=================================');

    // Subscribe to property changes
    thing.observeProperty('currentColor', async (data) => {
      const color = await data.value() as RGBColor;
      console.log(`Color: RGB(${color?.R}, ${color?.G}, ${color?.B})`);
    });

    thing.observeProperty('power', async (data) => {
      const power = await data.value();
      console.log(`Power: ${power ? 'ON' : 'OFF'}`);
    });

    thing.observeProperty('currentEffect', async (data) => {
      const effect = await data.value();
      console.log(`Effect: ${effect}`);
    });

    thing.observeProperty('brightness', async (data) => {
      const brightness = await data.value();
      console.log(`Brightness: ${brightness}%`);
    });

    // Subscribe to events
    thing.subscribeEvent('colorChanged', async (data) => {
      const eventData = await data.value();
      console.log(`Color Changed Event:`, eventData);
    });

    thing.subscribeEvent('powerChanged', async (data) => {
      const eventData = await data.value();
      console.log(`Power Changed Event:`, eventData);
    });

    thing.subscribeEvent('effectChanged', async (data) => {
      const eventData = await data.value();
      console.log(`Effect Changed Event:`, eventData);
    });

    // Centralized HTTP server details
    const centralizedHttpPort = 4000;
    const thingId = 'blergb';

    console.log(`\nCentralized HTTP server on port ${centralizedHttpPort}`);
    console.log('=================================');

    // Test sequence
    console.log('\nStarting test sequence...');
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    console.log('\n1. Reading initial state via WoT...');
    const initialColor = await thing.readProperty('currentColor');
    const initialPower = await thing.readProperty('power');
    const initialEffect = await thing.readProperty('currentEffect');
    const initialBrightness = await thing.readProperty('brightness');
    
    const colorValue = (await initialColor.value()) as RGBColor;
    console.log(`   Color: RGB(${colorValue?.R}, ${colorValue?.G}, ${colorValue?.B})`);
    console.log(`   Power: ${await initialPower.value() ? 'ON' : 'OFF'}`);
    console.log(`   Effect: ${await initialEffect.value()}`);
    console.log(`   Brightness: ${await initialBrightness.value()}%`);

    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log('\n2. Testing WoT Actions...');
    
    console.log('   Setting color to red (255,0,0)');
    await thing.invokeAction('setColor', { R: 255, G: 0, B: 0 });
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('   Setting brightness to 50%');
    await thing.invokeAction('setBrightness', { brightness: 50 });
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('   Setting effect to 135');
    await thing.invokeAction('setEffect', { effect: 135 });
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('   Turning power OFF');
    await thing.invokeAction('setPower', { state: false });

    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log('\n3. Testing HTTP simulation endpoints...');
    
    try {
      console.log('   GET /blergb/status (read all status)');
      const statusData = await makeHttpRequest(centralizedHttpPort, `/${thingId}/status`);
      console.log('   HTTP Response:', statusData);
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      console.log('   POST /blergb/power (turn ON)');
      const powerResponse = await makeHttpRequest(centralizedHttpPort, `/${thingId}/power`, 'POST', {
        state: true
      });
      console.log('   HTTP Response:', powerResponse);
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      console.log('   POST /blergb/color (set to blue)');
      const colorResponse = await makeHttpRequest(centralizedHttpPort, `/${thingId}/color`, 'POST', {
        R: 0, G: 0, B: 255
      });
      console.log('   HTTP Response:', colorResponse);
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      console.log('   GET /blergb/color/0/255/0 (set to green via URL)');
      const urlColorResponse = await makeHttpRequest(centralizedHttpPort, `/${thingId}/color/0/255/0`);
      console.log('   HTTP Response:', urlColorResponse);
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      console.log('   POST /blergb/brightness (set to 75%)');
      const brightnessResponse = await makeHttpRequest(centralizedHttpPort, `/${thingId}/brightness`, 'POST', {
        brightness: 75
      });
      console.log('   HTTP Response:', brightnessResponse);
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      console.log('   POST /blergb/effect (set effect 150)');
      const effectResponse = await makeHttpRequest(centralizedHttpPort, `/${thingId}/effect`, 'POST', {
        effect: 150
      });
      console.log('   HTTP Response:', effectResponse);
      
    } catch (error) {
      console.log(`   HTTP endpoints not available (port ${centralizedHttpPort}):`, (error as Error).message);
      console.log('   This is normal if the Thing hasn\'t fully initialized yet.');
    }

    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log('\n4. Final state readings via WoT...');
    const finalColor = await thing.readProperty('currentColor');
    const finalPower = await thing.readProperty('power');
    const finalBrightness = await thing.readProperty('brightness');
    const finalEffect = await thing.readProperty('currentEffect');
    
    const finalColorValue = (await finalColor.value()) as RGBColor;
    console.log(`   Final color: RGB(${finalColorValue?.R}, ${finalColorValue?.G}, ${finalColorValue?.B})`);
    console.log(`   Final power: ${await finalPower.value() ? 'ON' : 'OFF'}`);
    console.log(`   Final brightness: ${await finalBrightness.value()}%`);
    console.log(`   Final effect: ${await finalEffect.value()}`);

    console.log('\nTest completed!');
    console.log('\nYou can also test manually:');
    console.log(`   curl http://localhost:${centralizedHttpPort}/${thingId}/status`);
    console.log(`   curl -X POST http://localhost:${centralizedHttpPort}/${thingId}/color -H "Content-Type: application/json" -d '{"R": 255, "G": 128, "B": 0}'`);
    console.log(`   curl -X POST http://localhost:${centralizedHttpPort}/${thingId}/power -H "Content-Type: application/json" -d '{"state": true}'`);
    console.log(`   curl -X POST http://localhost:${centralizedHttpPort}/${thingId}/brightness -H "Content-Type: application/json" -d '{"brightness": 80}'`);
    console.log(`   curl -X POST http://localhost:${centralizedHttpPort}/${thingId}/effect -H "Content-Type: application/json" -d '{"effect": 140}'`);
    console.log(`   curl http://localhost:${centralizedHttpPort}/${thingId}/color/255/0/255  # Purple via URL`);

    console.log('\nKeep this running to see real-time events...');

  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    console.log('\nMake sure WoT Lab is running with:');
    console.log('   npm run dev');
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down BLE RGB Controller client...');
  process.exit(0);
});

// Start the test
testBLERGBController();
