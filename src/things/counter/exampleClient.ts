import { Servient } from '@node-wot/core';
import httpBinding from '@node-wot/binding-http';

const { HttpClientFactory } = httpBinding;
const servient = new Servient();
servient.addClientFactory(new HttpClientFactory(null));

servient.start().then(async (WoT) => {
  const td = await WoT.requestThingDescription('http://localhost:8081/counter');
    
  const thing = await WoT.consume(td);
  thing.observeProperty('count', async (data) => { console.log('count:', await data.value()); });
  for (let i = 0; i < 5; i++) {
    await thing.invokeAction('increment');
    await new Promise(resolve => setTimeout(resolve, 500)); // wait for 1 second
  }
}).catch((err) => { console.error(err); });