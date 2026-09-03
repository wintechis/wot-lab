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

/**
 * Register a Thing's state under the id it is exposed with.
 *
 * This throws rather than renaming on collision. Ids are allocated up front by
 * `ThingRegistry`, which is the single authority for them; if an id arrives
 * here twice, the allocator has been bypassed, and silently renaming would put
 * the state key out of step with the id in the Thing Description — the exact
 * drift that made the aggregated state untrustworthy.
 */
export function addThingToGlobalState(thingId: string, thingState: unknown): void {
  const id = normalizeThingId(thingId);
  if (isIdTaken(id)) {
    throw new Error(`Thing id '${id}' is already registered`);
  }
  debug(`Adding thing with ID: ${id}`);
  globalState.things[id] = thingState;
}

/**
 * The canonical spelling of an id: lowercase, with every run of other
 * characters collapsed to a single hyphen.
 *
 * The result is deliberately slug-shaped. node-wot derives a Thing's URL by
 * slugifying the title it is exposed under (see ThingFactory), so an id that is
 * already a slug survives that step unchanged — which is what lets the id, the
 * URL and the Thing Description's `id` be the same string.
 */
export function normalizeThingId(id: string): string {
  return id.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function isIdTaken(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(globalState.things, normalizeThingId(id));
}

export function removeThingFromGlobalState(thingId: string): void {
  delete globalState.things[normalizeThingId(thingId)];
}

export function getGlobalState(): GlobalStateType {
  return globalState;
}
