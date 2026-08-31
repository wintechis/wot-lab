import { Servient } from '@node-wot/core';
import httpBinding from '@node-wot/binding-http';

const { HttpClientFactory } = httpBinding;
const servient = new Servient();
servient.addClientFactory(new HttpClientFactory(null));

servient.start().then(async (WoT) => {
  const td = await WoT.requestThingDescription('http://localhost:8081/lamp');
    
  const thing = await WoT.consume(td);
  thing.observeProperty('brightness', async (data) => { console.log('brightness:', await data.value()); });

  await thing.invokeAction('toggle');
  await thing.invokeAction('setBrightness', 75);
  await new Promise(resolve => setTimeout(resolve, 500)); // wait for 0.5 seconds
  await thing.invokeAction('toggle');
  await thing.invokeAction('setBrightness', 50);

}).catch((err) => { console.error(err); });