import * as WoT from 'wot-typescript-definitions';
import { globalState, normalizeThingId } from '../globalState.js';
import { createLoggers } from '../utils/debug.js';

const { debug } = createLoggers('things');

/**
 * Cross-Thing effect support for VRE.
 *
 * A VRE effect can name another Thing — statically (`const bank = <uri>`) or
 * dynamically (an action input parameter carrying a Thing reference). Writing
 * to that Thing works because `globalState.things[id]` is the very Valtio proxy
 * that Thing's own read handlers serve, so a cross-Thing assignment is visible
 * through the target's `readProperty` immediately. The one thing the target
 * proxy cannot do is fire a WoT property-change notification, so we keep a
 * registry of exposed Things to reach `emitPropertyChange` on the right one.
 *
 * Everything is in-process: the benchmark environments are all local Things, so
 * no remote WoT calls are involved.
 */

const exposedThings = new Map<string, WoT.ExposedThing>();

// URI -> instance id. An environment manifest declares these so the URIs that
// appear in a Thing Description (`http://localhost:3001`) resolve to the local
// instance that plays that Thing. Empty until a manifest registers aliases.
const uriAliases = new Map<string, string>();

export function registerExposedThing(id: string, thing: WoT.ExposedThing): void {
  exposedThings.set(normalizeThingId(id), thing);
}

export function unregisterExposedThing(id: string): void {
  exposedThings.delete(normalizeThingId(id));
}

/** Map a URI (as written in a TD) to the local instance that plays it. */
export function setUriAlias(uri: string, id: string): void {
  uriAliases.set(uri, normalizeThingId(id));
  debug(`URI alias: ${uri} -> ${normalizeThingId(id)}`);
}

export function clearUriAliases(): void {
  uriAliases.clear();
}

/** A handle to another Thing's live state plus its change-notification hook. */
export interface ThingRef {
  id: string;
  state: Record<string, unknown>;
  // eslint-disable-next-line no-unused-vars
  emit(property: string): void;
}

/**
 * Resolve a reference — a URI, an alias, or a bare instance id — to another
 * Thing's live state. Resolution order: explicit alias, then a matching
 * instance id (after slug-normalisation), then the last path segment of a URI.
 * A reference that resolves to nothing throws: an unknown Thing is a
 * misconfigured environment, not a domain condition an action should tolerate.
 */
export function resolveThing(ref: string): ThingRef {
  const id = resolveId(String(ref));
  const things = globalState.things as Record<string, Record<string, unknown>>;
  const state = things[id];
  if (!state) {
    throw new Error(`VRE: no Thing resolves from '${ref}' (looked up id '${id}')`);
  }
  const exposed = exposedThings.get(id);
  return {
    id,
    state,
    emit(property: string): void {
      exposed?.emitPropertyChange(property);
    }
  };
}

function has(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(globalState.things, id);
}

function resolveId(ref: string): string {
  if (uriAliases.has(ref)) {
    return uriAliases.get(ref) as string;
  }
  const normalized = normalizeThingId(ref);
  if (has(normalized)) {
    return normalized;
  }
  const segments = ref.split(/[/#]/).filter(Boolean);
  const segment = segments[segments.length - 1];
  if (segment) {
    if (uriAliases.has(segment)) {
      return uriAliases.get(segment) as string;
    }
    const segmentId = normalizeThingId(segment);
    if (has(segmentId)) {
      return segmentId;
    }
  }
  return normalized;
}
