import { clearInterval, setInterval } from 'node:timers';

export interface SimulationOptions {
  time?: number; // Interval time in milliseconds
  maxIterations?: number; // Maximum number of iterations before stopping the simulation
}

export class Simulation {
  time: number = 250;
  iteration: number = 0;
  handlers: Function[] = [];
  maxIterations: number = 1000;
  interval: NodeJS.Timeout | undefined = undefined;

  constructor(time = 250, handlers?: Function[], options?: SimulationOptions) {
    this.time = time;
    this.handlers = handlers || [];
    if (options) {
      if (options.time) { this.time = options.time; }
      if (options.maxIterations) { this.maxIterations = options.maxIterations; }
    }
    console.log(`Simulation created with interval ${this.time} ms`);
  }

  simulationLoop() {
    for (const handler of this.handlers) {
      handler(this);
    }
    this.iteration++;
    if (this.iteration >= this.maxIterations) {
      if (this.interval) {
        clearInterval(this.interval);
        console.log('Simulation ended after max iterations');
      }
    }
  }
  
  start() {
    this.interval = setInterval(() => this.simulationLoop(), this.time);
  }
}