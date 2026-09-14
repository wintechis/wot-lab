import { createLoggers } from '../utils/debug.js';

const { debug } = createLoggers('config');

/** Port the WoT HTTP server listens on unless `--port` / `WOT_LAB_PORT` says otherwise. */
export const DEFAULT_PORT = 8081;

/** A request to bring `count` Things online from one Thing Model. */
export interface ThingRequest {
  /** The Thing Model to build them from. */
  model: string;
  count: number;
  /** Overrides the id prefix, which defaults to the model name. */
  idPrefix?: string;
}

export interface LabOptions {
  /** Things to create at startup. Empty is the default and is not an error. */
  things: ThingRequest[];
  /** An environment to bring online at startup (a named bundle of fixed-id Things). */
  env?: string;
  port: number;
  /**
   * Where Thing Models authored in the dashboard are written. Unset means
   * alongside the bundled ones, which is right for a checkout; a deployment
   * points it outside the release directory so authored models survive it.
   */
  modelsDir?: string;
}

/**
 * Render instance requests back as a `--things` argument.
 *
 * This is what makes a lab session reproducible without a config file: the UI
 * can hand back the exact flag that recreates whatever is currently running.
 */
export function formatThingsFlag(things: ThingRequest[]): string {
  return things
    .map(({ model, count }) => (count === 1 ? model : `${model}:${count}`))
    .join(',');
}

function parseThings(value: string): ThingRequest[] {
  const things: ThingRequest[] = [];

  for (const spec of value.split(',')) {
    const trimmed = spec.trim();
    if (!trimmed) {
      continue;
    }

    // `counter:2` asks for two; a bare `counter` asks for one. The count is
    // optional because the common case at a prompt is one of a thing.
    const [model, rawCount] = trimmed.split(':');
    const name = model.trim();
    if (!name) {
      throw new Error(`Invalid --things entry: '${trimmed}'`);
    }

    const count = rawCount === undefined ? 1 : Number.parseInt(rawCount, 10);
    if (!Number.isInteger(count) || count < 1) {
      throw new Error(`Invalid instance count for '${name}': '${rawCount}'`);
    }

    things.push({ model: name, count });
  }

  return things;
}

function flagValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

/**
 * Read startup options from the command line.
 *
 * Nothing is created implicitly: with no `--things`, the lab starts empty and
 * Things are brought up from the browser. That is what keeps a single way for a
 * Thing to come into existence, and therefore a single identity scheme.
 */
export function parseArgs(argv: string[] = process.argv): LabOptions {
  const things = flagValue(argv, '--things');
  const env = flagValue(argv, '--env') ?? process.env.WOT_LAB_ENV;
  const portFlag = flagValue(argv, '--port') ?? process.env.WOT_LAB_PORT;
  const modelsDir = flagValue(argv, '--models-dir') ?? process.env.WOT_LAB_MODELS_DIR;

  const port = portFlag === undefined ? DEFAULT_PORT : Number.parseInt(portFlag, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: '${portFlag}'`);
  }

  const requested = things === undefined ? [] : parseThings(things);
  debug(
    requested.length
      ? `Startup Things: ${formatThingsFlag(requested)}`
      : 'No --things given; starting with an empty lab'
  );

  if (modelsDir) {
    debug(`Authored Thing Models are stored in ${modelsDir}`);
  }

  if (env) {
    debug(`Startup environment: ${env}`);
  }

  return { things: requested, env, port, modelsDir };
}
