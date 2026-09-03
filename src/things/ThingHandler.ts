import * as WoT from 'wot-typescript-definitions';
import { addThingToGlobalState } from '../globalState.js';
import { proxy } from 'valtio/vanilla';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readdir } from 'fs/promises';
import { createLoggers } from '../utils/debug.js';
import { vreToHandlers } from './vre.js';

const { debug, warn, error } = createLoggers('things');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export abstract class ThingHandler {
  private td: WoT.ThingDescription;
  protected abstract state: ReturnType<typeof proxy>;

  constructor(td: WoT.ThingDescription) {
    this.td = td;
  }

  protected initializeGlobalState(): void {
    // Use the instance ID for global state, not the full URI
    const stateId = this.td.id
      ? this.td.id.replace('urn:wot:', '')
      : this.td.title || '';
    addThingToGlobalState(stateId, this.state);
  }

  // eslint-disable-next-line no-unused-vars
  abstract setup(thing: WoT.ExposedThing): Promise<void> | void;

  public get thingDescription(): WoT.ThingDescription {
    return this.td;
  }

  public get currentState(): ReturnType<typeof proxy> {
    return this.state;
  }
}

// Helper function to load a state JSON file
async function loadStateFile(
  filePath: string
): Promise<Record<string, unknown>> {
  // Bun.file(...).json() reads and parses in one native call
  const stateObject = await Bun.file(filePath).json();

  // Replace any timestamp placeholders with current time
  const currentTime = new Date().toISOString();
  const replaceTimestamps = (obj: unknown): unknown => {
    if (typeof obj === 'string' && obj.endsWith('T00:00:00.000Z')) {
      return currentTime;
    }
    if (typeof obj === 'object' && obj !== null) {
      for (const key in obj as Record<string, unknown>) {
        (obj as Record<string, unknown>)[key] = replaceTimestamps(
          (obj as Record<string, unknown>)[key]
        );
      }
    }
    return obj;
  };

  return replaceTimestamps(stateObject) as Record<string, unknown>;
}

// Helper function to evaluate a logic file (function body)
async function evaluateLogicFile(
  td: WoT.ThingDescription,
  filePath: string,
  vrePath: string
): Promise<
  (_thing: WoT.ExposedThing, _state: Record<string, unknown>) => Promise<void>
> {
  // logic.js is optional. A Thing can be declared purely as TD + state.json
  // (+ optional VRE effect annotations); when logic.js is absent we generate
  // default property read handlers from the TD so the Thing's state is still
  // observable over WoT. A present logic.js is used verbatim (it wires its own
  // read handlers), preserving existing behavior.
  const logicFile = Bun.file(filePath);
  const hasLogic = await logicFile.exists();
  let content = hasLogic ? await logicFile.text() : '';

  if (!hasLogic) {
    const propNames = Object.keys(td.properties ?? {});
    content = propNames
      .map(
        (p) =>
          `thing.setPropertyReadHandler(${JSON.stringify(
            p
          )}, async () => state[${JSON.stringify(p)}]);\n`
      )
      .join('');
  }

  // Generate action handlers from the Thing's VRE effect program (<name>.vre),
  // if present. VRE (see ./vre.ts) compiles effect assignments into
  // `state.X = ...` + emitPropertyChange and guards into throw-guards. It works
  // with or without logic.js.
  const vreFile = Bun.file(vrePath);
  if (await vreFile.exists()) {
    content += `\n${vreToHandlers(await vreFile.text(), td)}`;
  }

  // Import Node.js built-in modules that Things might need
  const http = await import('http');
  const url = await import('url');
  const { createLoggers } = await import('../utils/debug.js');

  // Wrap the content in an async function with built-in modules available
  const wrappedContent = `(async function(thing, state, http, URL, createLoggers) { ${content} })`;
  const logicFunction = eval(wrappedContent) as Function;

  return (thing: WoT.ExposedThing, state: Record<string, unknown>) =>
    logicFunction(
      thing,
      state,
      http,
      url.URL,
      createLoggers
    );
}

// Auto-loader for convention-based Things
export async function loadThing(
  thingName: string,
  instanceId?: string
): Promise<ThingHandler> {
  try {
    const basePath = join(__dirname, thingName);

    // Read the Thing Description natively via Bun.file
    const td: WoT.ThingDescription = await Bun.file(
      join(basePath, `${thingName}.td.json`)
    ).json();

    // Load TD, state, and behavior (logic.js and/or <name>.vre)
    const [stateObject, logicFunction] = await Promise.all([
      loadStateFile(join(basePath, 'state.json')),
      evaluateLogicFile(
        td,
        join(basePath, 'logic.js'),
        join(basePath, `${thingName}.vre`)
      )
    ]);

    return new (class extends ThingHandler {
      protected state = proxy(stateObject);

      constructor() {
        // Clone TD and set custom ID if provided
        const instanceTd = { ...td };
        if (instanceId) {
          instanceTd.id = `urn:wot:${instanceId}`; // Make it a proper URI
          instanceTd.title = instanceId;
        }

        super(instanceTd);
        this.initializeGlobalState();
      }

      async setup(thing: WoT.ExposedThing): Promise<void> {
        await logicFunction(thing, this.state);
      }
    })();
  } catch (error) {
    console.error(`ERROR: Error loading thing '${thingName}':`, error);
    throw error;
  }
}

/**
 * Create multiple instances of a Thing type
 */
export async function loadThingInstances(
  thingName: string,
  instanceCount: number,
  idPrefix?: string
): Promise<ThingHandler[]> {
  const handlers: ThingHandler[] = [];
  const prefix = idPrefix || thingName.toLowerCase();

  for (let i = 1; i <= instanceCount; i++) {
    const instanceId = instanceCount === 1 ? prefix : `${prefix}-${i}`;
    try {
      const handler = await loadThing(thingName, instanceId);
      handlers.push(handler);
      debug(`✓ Created instance: ${instanceId}`);
    } catch (e) {
      error(`ERROR: Failed to create instance ${instanceId}:`, e);
    }
  }

  return handlers;
}

// Load all things from a directory
export async function loadAllThings(
  thingsDir?: string
): Promise<ThingHandler[]> {
  const targetDir = thingsDir || __dirname;

  try {
    const entries = await readdir(targetDir, { withFileTypes: true });
    const thingDirs = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    const things: ThingHandler[] = [];
    for (const thingName of thingDirs) {
      try {
        const thing = await loadThing(thingName);
        things.push(thing);
      } catch (error) {
        warn(`Failed to load thing '${thingName}':`, error);
      }
    }

    return things;
  } catch (e) {
    error(`Failed to read things directory '${targetDir}':`, e);
    return [];
  }
}

/**
 * Configuration interface for Things
 */
interface ThingConfig {
  instances: number;
  idPrefix?: string;
}

interface Config {
  things: Record<string, ThingConfig>;
}

/**
 * Load Things based on configuration
 */
export async function loadConfiguredThings(
  config: Config
): Promise<ThingHandler[]> {
  const handlers: ThingHandler[] = [];

  debug('Loading Things based on configuration...');

  for (const [thingName, thingConfig] of Object.entries(config.things)) {
    const { instances, idPrefix } = thingConfig as {
      instances: number;
      idPrefix?: string;
    };

    debug(`Creating ${instances} instance(s) of '${thingName}'`);

    try {
      const thingHandlers = await loadThingInstances(
        thingName,
        instances,
        idPrefix
      );
      handlers.push(...thingHandlers);
    } catch (e) {
      error(`ERROR: Failed to load thing type '${thingName}':`, e);
    }
  }

  return handlers;
}
