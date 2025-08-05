import { proxy, subscribe } from 'valtio/vanilla';
import { createLoggers } from './utils/debug.js';

const { debug } = createLoggers('state');

export interface GlobalStateType {
  things: Record<string, unknown>;
}

export const globalState = proxy<GlobalStateType>({ things: {} });

// Subscribe to global state changes
subscribe(globalState, (ops) => {
  // Filter out metadata changes to avoid recursive logging
  const thingChanges = ops.filter(op => {
    const path = op[1];
    // Only log changes to things, not metadata
    return Array.isArray(path) && path[0] === 'things' && path.length >= 3;
  });

  if (thingChanges.length > 0) {
    thingChanges.forEach(op => {
      const [operation] = op;
      if (operation === 'set') {
        debug('Global state change:', ops);
      }
    });
  }
});

export function addThingToGlobalState(thingId: string, thingState: unknown): void {
  debug(`Adding thing with ID: ${thingId}`);
  thingId = ensureUniqueId(thingId);
  globalState.things[thingId] = thingState;
}

export function ensureUniqueId(id: string): string {
  id = id.replace(/\s+/g, '-').toLowerCase();
  // Ensure the ID is unique
  if (globalState.things[id]) {
    let counter = 1;
    while (globalState.things[`${id}-${counter}`]) {
      counter++;
    }
    id = `${id}-${counter}`;
  }
  return id;
}

export function removeThingFromGlobalState(thingId: string): void {
  delete globalState.things[thingId];
}

export function getGlobalState(): GlobalStateType {
  return globalState;
}