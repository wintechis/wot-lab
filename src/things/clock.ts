import { createLoggers } from '../utils/debug.js';

const { debug } = createLoggers('things');

/**
 * A controllable clock, so time-dependent behaviour (peak hours, timestamps) is
 * reproducible in a benchmark. Only the time SOURCE is virtual: `now()` in VRE
 * still yields a JavaScript ISO string, it just reads from here.
 *
 * `null` means the real wall clock. Set a virtual time to pin it; advance it to
 * step through a scenario deterministically.
 */
let virtualMillis: number | null = null;

export function nowMillis(): number {
  return virtualMillis ?? Date.now();
}

/** The current time as an ISO 8601 string — what VRE's `now()` returns. */
export function nowIso(): string {
  return new Date(nowMillis()).toISOString();
}

/** The hour of day (0-23) of the current time, in UTC — for peak-hour logic. */
export function nowHour(): number {
  return new Date(nowMillis()).getUTCHours();
}

export function setVirtualTime(time: number | string): void {
  const millis = typeof time === 'number' ? time : Date.parse(time);
  if (Number.isNaN(millis)) {
    throw new Error(`Invalid time '${time}'`);
  }
  virtualMillis = millis;
  debug(`Virtual clock set to ${nowIso()}`);
}

export function advanceClock(ms: number): void {
  if (!Number.isFinite(ms)) {
    throw new Error(`Invalid advance '${ms}'`);
  }
  virtualMillis = (virtualMillis ?? Date.now()) + ms;
  debug(`Virtual clock advanced to ${nowIso()}`);
}

export function useRealClock(): void {
  virtualMillis = null;
  debug('Clock back to real time');
}

export function clockStatus(): { mode: 'real' | 'virtual'; iso: string; millis: number } {
  return {
    mode: virtualMillis === null ? 'real' : 'virtual',
    iso: nowIso(),
    millis: nowMillis()
  };
}
