import { Simulation } from '../simulation.js';
import { globalState } from '../globalState.js';

let on = false;

export const time = 5000;

function brightnessHandler(simulation: Simulation) {
  if ((Object.keys(globalState.things).length === 0)) {
    console.log('No global state');
    return;
  }
  console.log(JSON.stringify(globalState.things));
  globalState.things['light-1'].on = !on;
  on = !on;
  console.log(`Brightness toggled to ${on}`);
}

function periodicDemo(simulation: Simulation) {
  if (simulation.iteration % 10 === 0) {
    console.log(`Iteration ${simulation.iteration}: Performing periodic demo action.`);
  }
}

export default [
  brightnessHandler,
  periodicDemo
];
