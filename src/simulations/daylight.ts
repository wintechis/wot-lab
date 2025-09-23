import { Simulation } from '../simulation.js';
import { globalState } from '../globalState.js';


const maxLux = 2000


let lux = 0;

export const time = 250;
export const startTime = 18 * 60 * 60 * 1000 - 5*1000 + (24 * 60 * 60 * 1000);


function brightnessHandler(simulation: Simulation) {
  if((simulation.iteration * time % (24*60*60*1000) ) <= (6 * 60 * 60 * 1000)){
    lux = 0
  }

  
  if(simulation.iteration * time % (24*60*60*1000) > (6 * 60 * 60 * 1000) && simulation.iteration * time % (24*60*60*1000)<= (10 * 60 * 60 * 1000)){
    lux =  maxLux * ((simulation.iteration * time % (24*60*60*1000)- 6 * 60 * 60 * 1000)  / (4 * 60 * 60 * 1000 ))
  }

  if(simulation.iteration * time% (24*60*60*1000) > (10 * 60 * 60 * 1000) && simulation.iteration * time% (24*60*60*1000) <= (14 * 60 * 60 * 1000)){
    lux = maxLux
  }

  if(simulation.iteration * time% (24*60*60*1000) > (14 * 60 * 60 * 1000) && simulation.iteration * time % (24*60*60*1000)<= (18 * 60 * 60 * 1000)){
    lux = maxLux * (1 - ((simulation.iteration * time % (24*60*60*1000)- 14 * 60 * 60 * 1000)  / (4 * 60 * 60 * 1000 )))
  }

  if((simulation.iteration * time% (24*60*60*1000) ) > (18 * 60 * 60 * 1000)){
    lux = 0
  }


  console.log(`${simulation.iteration}: Daylight brightness set to ${lux} lux`);

  console.log(globalState.things);

  globalState.things['brightnesssensor'].brightness = lux;
}


export default [
  brightnessHandler,
  //periodicDemo
];
