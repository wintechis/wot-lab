import * as WoT from 'wot-typescript-definitions';
import { Servient } from '@node-wot/core';
import {
  isIdTaken,
  normalizeThingId,
  removeThingFromGlobalState
} from '../globalState.js';
import { ThingRequest } from '../config/options.js';
import { createLoggers } from '../utils/debug.js';
import { ThingFactory } from './ThingFactory.js';
import {
  clearUriAliases,
  resolveThing,
  setUriAlias,
  unregisterExposedThing
} from './crossThing.js';
import { EnvManifest } from './environments.js';
import { setVirtualTime } from './clock.js';
import {
  ThingModelInfo,
  listThingModels,
  loadThing,
  readThingModel
} from './ThingHandler.js';

const { debug, info, error } = createLoggers('things');

/** A Thing that is currently exposed. */
export interface LabThing {
  id: string;
  /** The Thing Model it was made from — the directory in src/things/. */
  model: string;
  title: string;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export class ThingRegistry {
  private readonly factory: ThingFactory;
  private readonly things = new Map<string, LabThing>();
  // The state each Thing started with, so an environment run can be reset to its
  // initial conditions between benchmark runs.
  private readonly initialStates = new Map<string, Record<string, unknown>>();
  private currentEnvironment?: string;

  constructor(
    wot: typeof WoT,
    // eslint-disable-next-line no-unused-vars
    private readonly servient: Servient
  ) {
    this.factory = new ThingFactory(wot);
  }

  /** Thing Models available on disk. */
  listModels(): Promise<ThingModelInfo[]> {
    return listThingModels();
  }

  /** Things currently exposed, in creation order. */
  listThings(): LabThing[] {
    return [...this.things.values()];
  }

  /**
   * The `--things` argument that would recreate what is running now.
   *
   * With no config file, this is how a lab session becomes reproducible: the
   * flags and the browser are the same operation, so the running set can always
   * be rendered back as the command that produces it.
   */
  startupRequests(): ThingRequest[] {
    const counts = new Map<string, number>();
    for (const thing of this.things.values()) {
      counts.set(thing.model, (counts.get(thing.model) ?? 0) + 1);
    }
    return [...counts].map(([model, count]) => ({ model, count }));
  }

  /**
   * Reserve the next free id for a prefix: `lamp`, then `lamp-2`, `lamp-3`.
   *
   * Every id in the process is minted here — startup flags and browser requests
   * alike — so two callers can never race into the same id, and the id in the
   * Thing Description is always the id the state is registered under.
   */
  allocateId(prefix: string): { id: string; ordinal: number } {
    const base = normalizeThingId(prefix);
    if (!this.isTaken(base)) {
      return { id: base, ordinal: 1 };
    }
    // Start at 2: the unsuffixed id is instance one, so `lamp` and `lamp-2`
    // read as the first and second lamp rather than an off-by-one pair.
    for (let ordinal = 2; ; ordinal++) {
      const candidate = `${base}-${ordinal}`;
      if (!this.isTaken(candidate)) {
        return { id: candidate, ordinal };
      }
    }
  }

  private isTaken(id: string): boolean {
    return this.things.has(id) || isIdTaken(id);
  }

  /** Bring `count` Things online from a Thing Model. */
  async instantiate(
    model: string,
    count = 1,
    idPrefix?: string
  ): Promise<LabThing[]> {
    const modelInfo = await readThingModel(model);
    if (!modelInfo) {
      throw new Error(`Unknown Thing Model '${model}'`);
    }

    const created: LabThing[] = [];
    for (let index = 0; index < count; index++) {
      created.push(await this.instantiateOne(model, modelInfo, idPrefix ?? model));
    }
    return created;
  }

  private async instantiateOne(
    model: string,
    modelInfo: ThingModelInfo,
    prefix: string
  ): Promise<LabThing> {
    const { id, ordinal } = this.allocateId(prefix);
    // The model's own title is the name of the thing; the ordinal only
    // distinguishes siblings, so a lone Thing reads exactly as its model does.
    const title = ordinal === 1 ? modelInfo.title : `${modelInfo.title} ${ordinal}`;
    return this.bringOnline(model, id, title);
  }

  /**
   * Load, expose and register one Thing under a given id — the single place a
   * Thing actually comes online, whether its id was allocated (`--things`,
   * dashboard) or pinned (an environment). Captures the initial state for reset
   * and unwinds every registration on failure so a half-created id is never left
   * behind.
   */
  private async bringOnline(
    model: string,
    id: string,
    title: string,
    stateOverride?: Record<string, unknown>
  ): Promise<LabThing> {
    try {
      const handler = await loadThing(model, id, title, stateOverride);
      this.initialStates.set(id, clone(handler.currentState as Record<string, unknown>));
      const result = await this.factory.createThing(handler);
      if (!result.success) {
        throw new Error(result.error || 'failed to expose Thing');
      }
    } catch (cause) {
      // loadThing registers the Thing's state before it is exposed, so a failure
      // after that point would otherwise leave the id claimed by a Thing that
      // does not exist.
      removeThingFromGlobalState(id);
      unregisterExposedThing(id);
      this.initialStates.delete(id);
      throw cause;
    }

    const thing: LabThing = { id, model, title };
    this.things.set(id, thing);
    debug(`Created '${id}' from Thing Model '${model}'`);
    return thing;
  }

  /**
   * Bring a whole environment online: every Thing under its pinned id and
   * initial state, with the manifest's URI aliases registered first so a
   * scenario's cross-Thing references resolve to these instances.
   */
  async instantiateEnvironment(manifest: EnvManifest): Promise<LabThing[]> {
    clearUriAliases();
    for (const [uri, target] of Object.entries(manifest.uriAliases ?? {})) {
      setUriAlias(uri, target);
    }
    if (manifest.clock) {
      setVirtualTime(manifest.clock);
    }

    const created: LabThing[] = [];
    for (const spec of manifest.things) {
      const id = normalizeThingId(spec.id);
      if (this.isTaken(id)) {
        throw new Error(`Environment '${manifest.name}': id '${id}' is already in use`);
      }
      const modelInfo = await readThingModel(spec.model);
      if (!modelInfo) {
        throw new Error(`Environment '${manifest.name}': unknown Thing Model '${spec.model}'`);
      }
      created.push(await this.bringOnline(spec.model, id, spec.title ?? modelInfo.title, spec.state));
    }
    this.currentEnvironment = manifest.name;
    info(`Environment '${manifest.name}' online: ${created.map((t) => t.id).join(', ')}`);
    return created;
  }

  /** The environment currently loaded, if any. */
  environment(): string | undefined {
    return this.currentEnvironment;
  }

  /**
   * Reset a Thing to the state it started with. Re-applies each initial property
   * value to the live proxy and fires a change notification, so observers and
   * the next reader see the reset.
   */
  resetThing(id: string): boolean {
    const normalized = normalizeThingId(id);
    const initial = this.initialStates.get(normalized);
    if (!initial || !this.things.has(normalized)) {
      return false;
    }
    const ref = resolveThing(normalized);
    for (const key of Object.keys(initial)) {
      ref.state[key] = clone(initial[key]);
      ref.emit(key);
    }
    debug(`Reset '${normalized}' to its initial state`);
    return true;
  }

  /** Reset every running Thing to its initial state. Returns the ids reset. */
  resetAll(): string[] {
    const reset: string[] = [];
    for (const id of this.things.keys()) {
      if (this.resetThing(id)) {
        reset.push(id);
      }
    }
    info(`Reset ${reset.length} Thing(s) to initial state`);
    return reset;
  }

  /**
   * Set property values directly, bypassing TD writability. This is for
   * constructing initial conditions in a benchmark — it writes the Thing's state
   * proxy and fires change notifications, whether or not the TD marks the
   * property writable, which is exactly why it lives behind the loopback-gated
   * lab API rather than the WoT write path.
   */
  setProperties(id: string, values: Record<string, unknown>): boolean {
    const normalized = normalizeThingId(id);
    if (!this.things.has(normalized)) {
      return false;
    }
    const ref = resolveThing(normalized);
    for (const [key, value] of Object.entries(values)) {
      ref.state[key] = value;
      ref.emit(key);
    }
    debug(`Set ${Object.keys(values).length} propert(y/ies) on '${normalized}'`);
    return true;
  }

  /** Create everything the startup flags asked for. */
  async instantiateAll(requests: ThingRequest[]): Promise<LabThing[]> {
    const created: LabThing[] = [];
    for (const request of requests) {
      try {
        created.push(
          ...(await this.instantiate(request.model, request.count, request.idPrefix))
        );
      } catch (cause) {
        error(`Failed to create a Thing from '${request.model}':`, cause);
      }
    }
    return created;
  }

  /** Take a Thing offline. Returns false when no such Thing is exposed. */
  async remove(id: string): Promise<boolean> {
    const normalized = normalizeThingId(id);
    if (!this.things.has(normalized)) {
      return false;
    }

    await this.servient.destroyThing(`urn:wot:${normalized}`);
    removeThingFromGlobalState(normalized);
    unregisterExposedThing(normalized);
    this.things.delete(normalized);
    this.initialStates.delete(normalized);
    info(`Removed Thing '${normalized}'`);
    return true;
  }
}
