import { clearInterval, setInterval } from 'node:timers';

export interface SimulationOptions {
  time?: number; // Interval time in milliseconds
  maxIterations?: number; // Maximum number of iterations before stopping the simulation
  startTime?: number; // Starting iteration count
  speedup?: number; // Speedup factor for the simulation
}

export class Simulation {
  time: number = 250;
  iteration: number = 0;
  handlers: Function[] = [];
  maxIterations: number = 1000000;
  interval: NodeJS.Timeout | undefined = undefined;
  speedup = 1;

  constructor(time = 250, handlers?: Function[], options?: SimulationOptions) {
    this.time = time;
    this.handlers = handlers || [];
    if (options) {
      if (options.time) { this.time = options.time; }
      if (options.maxIterations) { this.maxIterations = options.maxIterations; }
      if (options.startTime){this.iteration = Math.floor((options.startTime|| 0) / this.time); }
      if (options.speedup) {this.speedup = (options.speedup || 1); }
    }
    console.log(`Simulation created with interval ${this.time} ms and speedup ${this.speedup} X`);

    console.log(`Starting iteration at ${this.iteration}`);
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
    this.interval = setInterval(() => this.simulationLoop(), this.time / this.speedup);
  }
}