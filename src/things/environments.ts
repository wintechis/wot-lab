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
  /**
   * An ISO time to pin the virtual clock to when the environment starts, so
   * time-dependent behaviour (peak hours) is deterministic from the first run.
   */
  clock?: string;
}

export interface EnvSummary {
  name: string;
  description?: string;
  things: number;
}

async function environmentFile(name: string): Promise<string | null> {
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
  }
  debug(`Loaded environment '${manifest.name}' with ${manifest.things.length} Thing(s)`);
  return manifest;
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
      summaries.push({ name: manifest.name, description: manifest.description, things: manifest.things.length });
    } catch (cause) {
      warn(`Skipping environment '${name}':`, cause);
    }
  }
  return summaries.sort((a, b) => a.name.localeCompare(b.name));
}
