import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readdir } from 'fs/promises';
import { createLoggers } from '../utils/debug.js';

const { debug, warn } = createLoggers('things');

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Environments — named bundles of Thing Models with fixed instance ids.
 *
 * An environment is the reproducible unit a benchmark runs against: the same
 * Things, under the same ids, with the same initial state, started by one
 * command. It is the deliberate second instantiation path (alongside `--things`
 * and the dashboard): unlike those, it pins ids instead of allocating them, so
 * a scenario's cross-Thing references resolve to known instances every run.
 */
export const bundledEnvironmentsDirectory = join(__dirname, '..', 'environments');

/** One Thing in an environment: a model, a fixed id, and optional state overrides. */
export interface EnvThingSpec {
  model: string;
  /** The fixed instance id. Pinned, not allocated, so references stay stable. */
  id: string;
  title?: string;
  /** Shallow overrides merged over the model's state.json initial values. */
  state?: Record<string, unknown>;
  /**
   * Per-instance `links` for the served Thing Description (replaces the model's).
   * Lets one shared model point at a different related Thing per instance — e.g.
   * a lamp linking to the plug that powers it.
   */
  links?: Record<string, unknown>[];
  /**
   * Extra top-level Thing Description keys for this instance, merged into the
   * served Thing Description.
   *
   * This is for what describes the instance rather than the type — the Brick
   * statements that say which room a sensor is a point of, for example. It is
   * deliberately not a way to give an instance its own affordances: effects are
   * compiled from the model's Thing Description at load, so an instance that
   * needs different Actions needs its own model.
   */
  td?: Record<string, unknown>;
}

export interface EnvManifest {
  name: string;
  description?: string;
  things: EnvThingSpec[];
  /**
   * URI -> instance id. A scenario Thing Description refers to peers by URI
   * (`http://localhost:3001`); this maps each to the local instance that plays
   * it, so cross-Thing VRE effects resolve without any remote call.
   */
  uriAliases?: Record<string, string>;
}

export interface EnvSummary {
  name: string;
  description?: string;
  things: number;
  /** How many benchmark tasks the environment's `tasks.json` holds. */
  tasks: number;
}

/** One `{thing, property, op, value}` claim a task's goal makes about the state. */
export interface GoalPredicate {
  thing: string;
  property: string;
  op: string;
  value: unknown;
}

/** One Action invocation — a step of a plan, and of a run. */
export interface PlanStep {
  thing: string;
  action: string;
  input: unknown;
}

/** A benchmark task as `tools/make_tasks.py` writes it. */
export interface EnvTask {
  id: string;
  environment: string;
  level: string;
  request: string;
  goal: GoalPredicate[];
  initialState: Record<string, Record<string, unknown>>;
  optimalPlan: PlanStep[];
  distractorPlan?: PlanStep[];
  naiveAttempt?: PlanStep[];
  note?: string;
}

// The same shape a Thing Model name has. The name arrives over HTTP and is
// joined into a path, so anything that could leave the directory is refused
// before it gets there.
const environmentNamePattern = /^[a-z][a-z0-9-]*$/;

async function environmentFile(name: string): Promise<string | null> {
  if (!environmentNamePattern.test(name)) {
    return null;
  }
  const file = join(bundledEnvironmentsDirectory, `${name}.json`);
  return (await Bun.file(file).exists()) ? file : null;
}

export async function loadEnvironmentManifest(name: string): Promise<EnvManifest> {
  const file = await environmentFile(name);
  if (!file) {
    throw new Error(`Unknown environment '${name}'`);
  }
  const manifest = (await Bun.file(file).json()) as EnvManifest;
  if (!manifest.name || !Array.isArray(manifest.things) || manifest.things.length === 0) {
    throw new Error(`Invalid environment manifest '${name}': needs a name and a non-empty things list`);
  }
  for (const spec of manifest.things) {
    if (!spec.model || !spec.id) {
      throw new Error(`Invalid environment manifest '${name}': every thing needs a model and an id`);
    }
    for (const reserved of ['id', 'title', 'links', 'properties', 'actions', 'events']) {
      if (spec.td && reserved in spec.td) {
        throw new Error(
          `Invalid environment manifest '${name}': thing '${spec.id}' sets '${reserved}' through 'td'; use the dedicated field, or a model of its own for affordances`
        );
      }
    }
  }
  debug(`Loaded environment '${manifest.name}' with ${manifest.things.length} Thing(s)`);
  return manifest;
}

/**
 * The benchmark tasks of an environment, from `src/environments/<name>/tasks.json`.
 * An environment without the file has no tasks; that is not an error.
 */
export async function loadEnvironmentTasks(name: string): Promise<EnvTask[]> {
  if (!(await environmentFile(name))) {
    throw new Error(`Unknown environment '${name}'`);
  }
  const file = Bun.file(join(bundledEnvironmentsDirectory, name, 'tasks.json'));
  if (!(await file.exists())) {
    return [];
  }
  const tasks = (await file.json()) as unknown;
  if (!Array.isArray(tasks)) {
    throw new Error(`Invalid tasks file for environment '${name}': expected an array`);
  }
  return tasks as EnvTask[];
}

/** The environments available on disk, for the dashboard and CLI help. */
export async function listEnvironments(): Promise<EnvSummary[]> {
  let entries;
  try {
    entries = await readdir(bundledEnvironmentsDirectory, { withFileTypes: true });
  } catch {
    return [];
  }
  const summaries: EnvSummary[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue;
    }
    const name = entry.name.slice(0, -'.json'.length);
    try {
      const manifest = await loadEnvironmentManifest(name);
      // Keyed by file name, as the manifest is: that is the name a caller starts it by.
      const tasks = await loadEnvironmentTasks(name).catch(() => []);
      summaries.push({
        name: manifest.name,
        description: manifest.description,
        things: manifest.things.length,
        tasks: tasks.length
      });
    } catch (cause) {
      warn(`Skipping environment '${name}':`, cause);
    }
  }
  return summaries.sort((a, b) => a.name.localeCompare(b.name));
}
