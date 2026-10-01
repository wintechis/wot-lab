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
  /**
   * An LDP container — a Solid pod's, typically — that every WoT interaction's
   * provenance is posted to. Unset means nothing is posted: the lab makes no
   * outbound requests unless asked to.
   */
  solidContainer?: string;
  /**
   * A client credentials token's id and secret, from the Solid server's account
   * page. Both or neither: with them the lab authenticates to the pod with
   * Solid-OIDC, without them it posts as the public, which is all an open
   * container needs.
   */
  solidClientId?: string;
  solidClientSecret?: string;
  /**
   * The request header a client names itself in, which a provenance record
   * reports as the agent. Unset means `x-agent`.
   */
  agentHeader?: string;
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

/**
 * Check and normalise a container URL.
 *
 * The trailing slash is added rather than demanded: POSTing to an LDP container
 * without it is a redirect at best and a 404 at worst, and a missing slash is a
 * typo every time, never an intent.
 */
function parseContainer(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid --solid-container: '${value}' is not a URL`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Invalid --solid-container: '${value}' must be http(s)`);
  }
  if (url.search || url.hash) {
    throw new Error(`Invalid --solid-container: '${value}' must be a plain container URL`);
  }
  return url.pathname.endsWith('/') ? url.href : `${url.href}/`;
}

// RFC 9110 field names: a token, and nothing a header name cannot be. Checked
// because a name with a space or a colon in it would never match a header and
// would silently leave every record with an address for an agent.
const headerName = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;

function parseHeaderName(value: string): string {
  if (!headerName.test(value)) {
    throw new Error(`Invalid --agent-header: '${value}' is not a header name`);
  }
  return value.toLowerCase();
}

/**
 * Check the credentials against the container they will be sent to.
 *
 * Both or neither, because half a credential is a typo that would otherwise show
 * up as a pod refusing every record. Over plaintext only on a loopback host: the
 * secret and the token it buys travel in those requests, and a pod reached over
 * `http://` across a network would hand both to anyone on the path.
 */
function checkCredentials(id: string | undefined, secret: string | undefined, container: string | undefined): void {
  if (!id && !secret) {
    return;
  }
  if (!id || !secret) {
    throw new Error('--solid-client-id and --solid-client-secret must be given together');
  }
  if (!container) {
    debug('Solid credentials given without --solid-container; nothing is posted, so they are unused');
    return;
  }
  const url = new URL(container);
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !loopback) {
    throw new Error(`Refusing to send Solid credentials to '${url.origin}' in the clear: use https`);
  }
  debug(`Authenticating to ${url.origin} as client '${id}'`);
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
  const container = flagValue(argv, '--solid-container') ?? process.env.WOT_LAB_SOLID_CONTAINER;
  const agentHeaderFlag = flagValue(argv, '--agent-header') ?? process.env.WOT_LAB_AGENT_HEADER;
  const solidClientId = flagValue(argv, '--solid-client-id') ?? process.env.WOT_LAB_SOLID_CLIENT_ID;
  const solidClientSecret = flagValue(argv, '--solid-client-secret') ?? process.env.WOT_LAB_SOLID_CLIENT_SECRET;

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

  const solidContainer = container ? parseContainer(container) : undefined;
  if (solidContainer) {
    debug(`Interaction provenance is posted to ${solidContainer}`);
  }

  checkCredentials(solidClientId, solidClientSecret, solidContainer);

  const agentHeader = agentHeaderFlag ? parseHeaderName(agentHeaderFlag) : undefined;
  if (agentHeader) {
    debug(`Requesting agents are read from the '${agentHeader}' header`);
  }

  return { things: requested, env, port, modelsDir, solidContainer, solidClientId, solidClientSecret, agentHeader };
}
