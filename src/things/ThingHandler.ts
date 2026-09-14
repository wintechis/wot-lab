import * as WoT from 'wot-typescript-definitions';
import { addThingToGlobalState } from '../globalState.js';
import { proxy } from 'valtio/vanilla';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readdir } from 'fs/promises';
import { createLoggers } from '../utils/debug.js';
import { vreEffectsToHandlers } from './vre.js';
import { resolveThing } from './crossThing.js';

const { debug, warn } = createLoggers('things');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Thing Models that ship with the lab, one sub-directory each. */
export const bundledModelsDirectory = __dirname;

// Where models authored at runtime are written. Left unset, authoring writes
// alongside the bundled models, which is what you want in a checkout. A
// deployment points it somewhere outside the release directory, so a model
// someone wrote in the dashboard is not part of the code that gets replaced on
// the next deploy.
let userModelsDirectory: string | undefined;

export function setUserModelsDirectory(directory?: string): void {
  userModelsDirectory = directory;
}

export function getUserModelsDirectory(): string | undefined {
  return userModelsDirectory;
}

/** Where a newly authored Thing Model is written. */
export function authoringDirectory(): string {
  return userModelsDirectory ?? bundledModelsDirectory;
}

/**
 * The roots that make up the catalog, most specific first.
 *
 * A user model shadows a bundled one of the same name — the lab's own copy is
 * never edited in place, so overriding is the only way to change a shipped
 * model, and it stays reversible by deleting the override.
 */
export function modelRoots(): string[] {
  return userModelsDirectory ? [userModelsDirectory, bundledModelsDirectory] : [bundledModelsDirectory];
}

/** The directory a Thing Model lives in, or null when no root holds it. */
export async function resolveModelDirectory(name: string): Promise<string | null> {
  for (const root of modelRoots()) {
    if (await Bun.file(join(root, name, `${name}.td.json`)).exists()) {
      return join(root, name);
    }
  }
  return null;
}

export abstract class ThingHandler {
  private td: WoT.ThingDescription;
  protected abstract state: ReturnType<typeof proxy>;

  constructor(td: WoT.ThingDescription) {
    this.td = td;
  }

  protected initializeGlobalState(): void {
    // Use the instance ID for global state, not the full URI. `loadThing`
    // guarantees an id is present, so this never falls back to a title.
    addThingToGlobalState((this.td.id as string).replace('urn:wot:', ''), this.state);
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
  instanceId: string
): Promise<
  (_thing: WoT.ExposedThing, _state: Record<string, unknown>) => Promise<void>
> {
  // logic.js is optional. A Thing can be declared purely as TD + state.json
  // (+ optional `vre:effects` annotations); when logic.js is absent we generate
  // default property read handlers from the TD so the Thing's state is still
  // observable over WoT. A present logic.js is used verbatim (it wires its own
  // read handlers), preserving existing behavior.
  const logicFile = Bun.file(filePath);
  const hasLogic = await logicFile.exists();
  let content = hasLogic ? await logicFile.text() : '';

  if (!hasLogic) {
    const properties = Object.entries(td.properties ?? {}) as [
      string,
      { readOnly?: boolean }
    ][];
    content = properties
      .map(([name, schema]) => {
        const key = JSON.stringify(name);
        const read = `thing.setPropertyReadHandler(${key}, async () => state[${key}]);\n`;
        if (schema?.readOnly) {
          return read;
        }
        // A property the TD says is writable has to actually accept a write.
        // Without this the affordance is advertised, node-wot has no handler
        // for it, and a PUT fails — so the TD would be promising something the
        // Thing cannot do. The change is emitted for the same reason a VRE
        // effect emits: so observers see it, not just the next reader.
        return (
          read +
          `thing.setPropertyWriteHandler(${key}, async (value) => { state[${key}] = await value.value(); thing.emitPropertyChange(${key}); });\n`
        );
      })
      .join('');
  }

  // Generate action handlers from the `vre:effects` annotations in the Thing
  // Description. VRE (see ./vre.ts) compiles effect assignments into
  // `state.X = ...` + emitPropertyChange. Effects live on the affordance they
  // belong to, and work with or without logic.js.
  content += `\n${vreEffectsToHandlers(td)}`;

  // Import Node.js built-in modules that Things might need
  const http = await import('http');
  const url = await import('url');
  const { createLoggers } = await import('../utils/debug.js');

  // Wrap the content in an async function with built-in modules available.
  // `resolveThing` and `__thingId` back VRE's cross-Thing effects and `this.id`;
  // a hand-written logic.js may use them too but does not have to.
  const wrappedContent = `(async function(thing, state, http, URL, createLoggers, resolveThing, __thingId) { ${content} })`;
  const logicFunction = eval(wrappedContent) as Function;

  return (thing: WoT.ExposedThing, state: Record<string, unknown>) =>
    logicFunction(
      thing,
      state,
      http,
      url.URL,
      createLoggers,
      resolveThing,
      instanceId
    );
}

/**
 * Load one Thing from its Thing Model on disk.
 *
 * `instanceId` is required, and that is the point: it is the only thing
 * standing between a Thing and an anonymous Thing Description, which node-wot
 * answers by minting a random `urn:uuid:` id — a different URL on every boot.
 * Making the caller name the instance makes that state unrepresentable.
 *
 * The instance id sets the Thing Description's `id` only. The `title` is the
 * type's own human name and survives untouched unless `title` overrides it,
 * so "Motion Sensor" never becomes "motion".
 */
export async function loadThing(
  modelName: string,
  instanceId: string,
  title?: string
): Promise<ThingHandler> {
  try {
    const basePath = await resolveModelDirectory(modelName);
    if (!basePath) {
      throw new Error(`Unknown Thing Model '${modelName}'`);
    }

    // Read the Thing Description natively via Bun.file
    const td: WoT.ThingDescription = await Bun.file(
      join(basePath, `${modelName}.td.json`)
    ).json();

    // Load TD, state, and behavior (logic.js and/or `vre:effects`)
    const [stateObject, logicFunction] = await Promise.all([
      loadStateFile(join(basePath, 'state.json')),
      evaluateLogicFile(td, join(basePath, 'logic.js'), instanceId)
    ]);

    return new (class extends ThingHandler {
      protected state = proxy(stateObject);

      constructor() {
        const instanceTd = { ...td, id: `urn:wot:${instanceId}` };
        if (title) {
          instanceTd.title = title;
        }

        super(instanceTd);
        this.initializeGlobalState();
      }

      async setup(thing: WoT.ExposedThing): Promise<void> {
        await logicFunction(thing, this.state);
      }
    })();
  } catch (error) {
    console.error(`ERROR: Error loading Thing Model '${modelName}':`, error);
    throw error;
  }
}

/**
 * A Thing Model on disk: the Thing Description and state a Thing is made from,
 * before any instance of it exists.
 */
export interface ThingModelInfo {
  name: string;
  title: string;
  description?: string;
  hasLogic: boolean;
  /** False for a model that ships with the lab: it may be read, never deleted. */
  writable: boolean;
}

/**
 * Read one Thing Model's descriptor, or null when the directory is not one.
 *
 * A directory is a Thing Model exactly when it holds `<name>.td.json`; anything
 * else in `src/things/` (the loader modules, for instance) is simply not a
 * model, so it is skipped rather than warned about.
 */
export async function readThingModel(name: string): Promise<ThingModelInfo | null> {
  const basePath = await resolveModelDirectory(name);
  if (!basePath) {
    return null;
  }
  const tdFile = Bun.file(join(basePath, `${name}.td.json`));

  try {
    const td = (await tdFile.json()) as WoT.ThingDescription;
    return {
      name,
      title: td.title || name,
      description: td.description,
      hasLogic: await Bun.file(join(basePath, 'logic.js')).exists(),
      writable: basePath === join(authoringDirectory(), name)
    };
  } catch (cause) {
    warn(`Skipping Thing Model '${name}': unreadable Thing Description`, cause);
    return null;
  }
}

/**
 * The catalog: Thing Models present on disk.
 *
 * This reads Thing Descriptions and nothing else — no state, no logic, no
 * `eval`, no exposure. Having a model and running a Thing from it are separate
 * acts, which is why adding a directory can no longer change what is live.
 */
export async function listThingModels(): Promise<ThingModelInfo[]> {
  const byName = new Map<string, ThingModelInfo>();

  for (const root of modelRoots()) {
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      // A user models directory that does not exist yet is empty, not broken.
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || byName.has(entry.name)) {
        continue;
      }
      const model = await readThingModel(entry.name);
      if (model) {
        byName.set(entry.name, model);
      }
    }
  }

  const models = [...byName.values()];
  debug(`Thing Models on disk: ${models.map((model) => model.name).join(', ') || '(none)'}`);
  return models.sort((a, b) => a.name.localeCompare(b.name));
}
