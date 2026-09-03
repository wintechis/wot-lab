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

export class ThingRegistry {
  private readonly factory: ThingFactory;
  private readonly things = new Map<string, LabThing>();

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

    try {
      const handler = await loadThing(model, id, title);
      const result = await this.factory.createThing(handler);
      if (!result.success) {
        throw new Error(result.error || 'failed to expose Thing');
      }
    } catch (cause) {
      // loadThing registers the Thing's state before it is exposed, so a
      // failure after that point would otherwise leave the id claimed by a
      // Thing that does not exist.
      removeThingFromGlobalState(id);
      throw cause;
    }

    const thing: LabThing = { id, model, title };
    this.things.set(id, thing);
    debug(`Created '${id}' from Thing Model '${model}'`);
    return thing;
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
    this.things.delete(normalized);
    info(`Removed Thing '${normalized}'`);
    return true;
  }
}
