import { IncomingMessage, ServerResponse } from 'http';
import { URL } from 'url';
import { formatThingsFlag } from '../config/options.js';
import { createLoggers } from '../utils/debug.js';
import { ThingRegistry } from '../things/ThingRegistry.js';
import { listEnvironments, loadEnvironmentManifest, loadEnvironmentTasks } from '../things/environments.js';
import {
  ThingDraft,
  ThingSpec,
  buildDraft,
  deleteThingModel,
  validateDraft,
  writeDraft
} from '../things/ThingAuthor.js';

const { debug, warn } = createLoggers('system');

/** URL prefix the lab API owns. Thing types may not be named this. */
export const labPrefix = '_lab';

// A Thing Description plus its state is small; anything approaching this is a
// mistake or an attack, and reading it would cost memory either way.
const maxBodyBytes = 256 * 1024;

const loopbackAddresses = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * Writes are refused from off-box by default.
 *
 * This API creates files and brings Things online, and the WoT server binds
 * every interface, so without this the lab would offer anyone on the network a
 * way to write into the repository. `WOT_LAB_ALLOW_REMOTE_WRITE=1` opts out for
 * a deliberately shared lab.
 */
function isWriteAllowed(req: IncomingMessage): boolean {
  if (process.env.WOT_LAB_ALLOW_REMOTE_WRITE === '1') {
    return true;
  }
  const address = req.socket.remoteAddress ?? '';
  return loopbackAddresses.has(address);
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.byteLength;
    if (size > maxBodyBytes) {
      throw new Error('Request body too large');
    }
    chunks.push(buffer);
  }

  if (!size) {
    return {};
  }

  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Request body must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

/**
 * Resolve a request body into the files to be written.
 *
 * The form sends a `spec`; the JSON escape hatch sends `draft` — the two files
 * as typed. Either way the result goes through the same validation, so the
 * escape hatch cannot slip past a check the form enforces.
 */
function draftFromBody(body: Record<string, unknown>): ThingDraft {
  if (body.draft) {
    const draft = body.draft as Partial<ThingDraft>;
    return {
      name: String(draft.name ?? ''),
      td: (draft.td ?? {}) as Record<string, unknown>,
      state: (draft.state ?? {}) as Record<string, unknown>
    };
  }
  const spec = body.spec as ThingSpec | undefined;
  if (!spec) {
    throw new Error('Expected a `spec` or `draft` in the request body');
  }
  return buildDraft({
    name: String(spec.name ?? ''),
    title: String(spec.title ?? ''),
    description: spec.description,
    properties: spec.properties ?? [],
    actions: spec.actions ?? [],
    events: spec.events ?? []
  });
}

async function thingsPayload(registry: ThingRegistry) {
  const requests = registry.startupRequests();
  const environment = registry.environment();
  // The flags that reproduce this session — the replacement for a config file.
  // An environment's Things come back through `--env`, which pins their ids and
  // state; `--things` would allocate new ones. An empty lab needs no flag at all.
  const flags = [
    ...(environment ? [`--env ${environment}`] : []),
    ...(requests.length ? [`--things ${formatThingsFlag(requests)}`] : [])
  ];
  return {
    things: registry.listThings(),
    startCommand: flags.length ? `bun run dev -- ${flags.join(' ')}` : 'bun run dev'
  };
}

/**
 * The lab API: list Thing Models, create Things from them, author new models,
 * take Things offline.
 *
 * Every route here funnels into `ThingRegistry`, the same object the startup
 * flags use, so a Thing created from the browser is indistinguishable from one
 * named on the command line.
 */
export function createLabApi(registry: ThingRegistry) {
  return async function handleLabRequest(
    req: IncomingMessage,
    res: ServerResponse,
    segments: string[],
    url: URL
  ): Promise<boolean> {
    const [resource, id, member] = segments;
    const method = req.method ?? 'GET';

    if (method !== 'GET' && !isWriteAllowed(req)) {
      warn(`Refused ${method} /${labPrefix} from ${req.socket.remoteAddress}`);
      sendJson(res, 403, {
        error: 'Lab changes are only allowed from this machine. Set WOT_LAB_ALLOW_REMOTE_WRITE=1 to override.'
      });
      return true;
    }

    try {
      if (method === 'GET' && resource === 'thing-models') {
        sendJson(res, 200, { thingModels: await registry.listModels() });
        return true;
      }

      // /_lab/things is the collection of running Things: GET lists them (with
      // the flag that reproduces them), POST adds more from a Thing Model.
      if (method === 'GET' && resource === 'things') {
        sendJson(res, 200, await thingsPayload(registry));
        return true;
      }

      if (method === 'POST' && resource === 'things') {
        const body = await readJsonBody(req);
        const model = String(body.model ?? '');
        const count = Number(body.count ?? 1);
        if (!model) {
          sendJson(res, 400, { error: 'A Thing Model is required' });
          return true;
        }
        if (!Number.isInteger(count) || count < 1 || count > 50) {
          sendJson(res, 400, { error: 'Count must be between 1 and 50' });
          return true;
        }
        const created = await registry.instantiate(model, count);
        debug(`Created ${created.length} Thing(s) from Thing Model '${model}'`);
        sendJson(res, 201, { things: created });
        return true;
      }

      // Without an id, DELETE empties the lab.
      if (method === 'DELETE' && resource === 'things' && !id) {
        sendJson(res, 200, { removed: await registry.removeAll() });
        return true;
      }

      if (method === 'DELETE' && resource === 'things' && id) {
        const removed = await registry.remove(decodeURIComponent(id));
        if (!removed) {
          sendJson(res, 404, { error: `No Thing '${id}' is exposed` });
          return true;
        }
        // Removing the files is a separate, explicit act: taking a Thing
        // offline is undoable, deleting what someone authored is not.
        if (url.searchParams.get('files') === 'true') {
          const model = String(url.searchParams.get('model') ?? '');
          if (model) {
            await deleteThingModel(model);
          }
        }
        sendJson(res, 200, { removed: true });
        return true;
      }

      // Environments: named bundles of Things with fixed ids. GET lists what is
      // on disk; POST brings one online (the benchmark's start command).
      // The benchmark tasks of one environment: what a run is replayed against.
      if (method === 'GET' && resource === 'environments' && id && member === 'tasks') {
        sendJson(res, 200, { tasks: await loadEnvironmentTasks(decodeURIComponent(id)) });
        return true;
      }

      if (method === 'GET' && resource === 'environments' && !id) {
        // `current` is what a task runner checks before replaying a plan: the
        // list says what could run, this says what is running.
        sendJson(res, 200, {
          current: registry.environment(),
          environments: await listEnvironments()
        });
        return true;
      }

      if (method === 'POST' && resource === 'environments') {
        const body = await readJsonBody(req);
        const name = String(body.name ?? '');
        if (!name) {
          sendJson(res, 400, { error: 'An environment name is required' });
          return true;
        }
        const manifest = await loadEnvironmentManifest(name);
        // `replace` takes whatever is running offline first; without it a start
        // is refused when any of the manifest's ids is in use.
        const things = await registry.instantiateEnvironment(manifest, { replace: body.replace === true });
        sendJson(res, 201, { environment: manifest.name, things });
        return true;
      }

      // Reset every running Thing (or one, with {"id": ...}) to its initial
      // state — the between-runs reset a benchmark needs.
      if (method === 'POST' && resource === 'reset') {
        const body = await readJsonBody(req);
        if (body.id) {
          const ok = registry.resetThing(String(body.id));
          sendJson(res, ok ? 200 : 404, ok ? { reset: [String(body.id)] } : { error: `No Thing '${body.id}'` });
          return true;
        }
        sendJson(res, 200, { reset: registry.resetAll() });
        return true;
      }

      // Set property values directly, bypassing TD writability — for
      // constructing initial conditions.
      if (method === 'POST' && resource === 'state') {
        const body = await readJsonBody(req);
        const id = String(body.id ?? '');
        const values = body.values;
        if (!id || !values || typeof values !== 'object' || Array.isArray(values)) {
          sendJson(res, 400, { error: 'Expected {"id": ..., "values": { property: value, ... }}' });
          return true;
        }
        const ok = registry.setProperties(id, values as Record<string, unknown>);
        sendJson(res, ok ? 200 : 404, ok ? { id, set: Object.keys(values) } : { error: `No Thing '${id}'` });
        return true;
      }

      if (method === 'POST' && resource === 'thing-models') {
        const body = await readJsonBody(req);
        const draft = draftFromBody(body);
        const errors = await validateDraft(draft);

        // `validate` is the same code path as `create` minus the writing, so
        // the preview in the browser cannot drift from what would happen.
        if (id === 'validate') {
          sendJson(res, 200, { draft, errors });
          return true;
        }
        if (errors.length) {
          sendJson(res, 422, { draft, errors });
          return true;
        }

        await writeDraft(draft);
        const things = body.instantiate === false
          ? []
          : await registry.instantiate(draft.name, 1);
        sendJson(res, 201, { draft, things });
        return true;
      }

      sendJson(res, 404, { error: 'Unknown lab endpoint' });
      return true;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      warn(`Lab API error on ${method} ${url.pathname}:`, message);
      sendJson(res, 400, { error: message });
      return true;
    }
  };
}
