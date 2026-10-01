import { IncomingMessage, ServerResponse } from 'http';
import { URL } from 'url';
import { labPrefix } from './labApi.js';
import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'zlib';
import * as WoT from 'wot-typescript-definitions';
import { isAgentIri, RequestAgent, WotOperation } from '../solid/stateResource.js';
import { agentHeaderName, currentRunContainer, existingProducts, isStateSinkEnabled, publishThingState } from '../solid/stateSink.js';
import { createLoggers } from '../utils/debug.js';
import { isResourceId, resourceIdList, resourcePrefix } from '../things/resources.js';
import { productTurtle } from '../things/resourceTurtle.js';
import { globalState, normalizeThingId } from '../globalState.js';

const { warn } = createLoggers('state');

interface Endpoint {
  name: string;
  method: string;
  href: string;
  description: string;
  input?: unknown;
}

interface Schema {
  type?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  properties?: Record<string, Schema>;
  required?: string[];
}

type ThingMap = Map<string, WoT.ExposedThing>;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      '\'': '&#39;'
    };
    return entities[character];
  });
}

function thingDescription(thing: WoT.ExposedThing): WoT.ThingDescription {
  return thing.getThingDescription();
}

function thingId(thing: WoT.ExposedThing): string {
  const td = thingDescription(thing);
  return (td.id || td.title || '').replace('urn:wot:', '');
}

function endpointsForThing(thing: WoT.ExposedThing): Endpoint[] {
  const td = thingDescription(thing);
  const id = encodeURIComponent(thingId(thing));
  const endpoints: Endpoint[] = [
    {
      name: 'Thing Description',
      method: 'GET',
      href: `/${id}`,
      description: 'Machine-readable Thing Description'
    }
  ];

  for (const [name, property] of Object.entries(td.properties || {})) {
    const propertyPath = `/${id}/properties/${encodeURIComponent(name)}`;
    endpoints.push({
      name: `Read property: ${name}`,
      method: 'GET',
      href: propertyPath,
      description: property.description || 'Read a property value'
    });
    if (!property.readOnly) {
      endpoints.push({
        name: `Write property: ${name}`,
        method: 'PUT',
        href: propertyPath,
        description: property.description || 'Write a property value',
        input: property
      });
    }
    if (property.observable) {
      endpoints.push({
        name: `Observe property: ${name}`,
        method: 'GET',
        href: `${propertyPath}/observable`,
        description: 'Long-poll property observation'
      });
    }
  }

  for (const [name, action] of Object.entries(td.actions || {})) {
    endpoints.push({
      name: `Invoke action: ${name}`,
      method: 'POST',
      href: `/${id}/actions/${encodeURIComponent(name)}`,
      description: action.description || 'Invoke an action',
      input: action.input
    });
  }

  for (const [name, event] of Object.entries(td.events || {})) {
    endpoints.push({
      name: `Subscribe to event: ${name}`,
      method: 'GET',
      href: `/${id}/events/${encodeURIComponent(name)}`,
      description: event.description || 'Long-poll event subscription'
    });
  }

  return endpoints;
}

function writeJson(res: ServerResponse, value: unknown, status = 200): void {
  const body = JSON.stringify(value, null, 2);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function writeHtml(res: ServerResponse, title: string, body: string): void {
  const page = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} | WoT Lab</title>
  <style>
    :root { color-scheme: light; font-family: system-ui, sans-serif; color: #1f2937; background: #f3f4f6; }
    body { margin: 0; }
    main { max-width: 960px; margin: 0 auto; padding: 2rem 1rem 4rem; }
    a { color: #0369a1; }
    nav { margin-bottom: 2rem; }
    h1 { margin-bottom: .35rem; }
    p { color: #4b5563; }
    table { width: 100%; border-collapse: collapse; background: white; box-shadow: 0 1px 3px #0001; }
    th, td { padding: .75rem 1rem; border-bottom: 1px solid #e5e7eb; text-align: left; vertical-align: top; }
    th { background: #e0f2fe; color: #0c4a6e; }
    code { font-family: ui-monospace, monospace; }
    .method { font-weight: 700; color: #166534; }
    details { min-width: 18rem; }
    summary { cursor: pointer; }
    form { display: grid; gap: .5rem; margin-top: .75rem; }
    textarea { min-height: 5rem; width: min(100%, 28rem); font: inherit; }
    input, select { max-width: 28rem; padding: .35rem; font: inherit; }
    label { display: grid; gap: .25rem; max-width: 28rem; }
    button { width: fit-content; padding: .4rem .75rem; cursor: pointer; }
    pre { max-width: 42rem; max-height: 16rem; overflow: auto; white-space: pre-wrap; }
    .result { background: #f8fafc; padding: .5rem; }
    .validation-error { color: #b91c1c; }
  </style>
</head>
<body><main>${body}</main>
<script>
  document.querySelectorAll('[data-endpoint-form]').forEach(function (form) {
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      const result = form.querySelector('.result');
      const method = form.dataset.method;
      const options = { method: method, headers: {} };
      let payload;
      const schema = form.dataset.schema ? JSON.parse(form.dataset.schema) : null;
      const fields = Array.from(form.querySelectorAll('[data-field]'));
      const errors = [];
      if (schema && schema.type === 'object') {
        payload = {};
        fields.forEach(function (field) {
          const name = field.dataset.field;
          const raw = field.type === 'checkbox' ? field.checked : field.value.trim();
          const property = schema.properties[name] || {};
          if (raw === '' && !field.checked && !(schema.required || []).includes(name)) return;
          if (raw === '' && (schema.required || []).includes(name)) {
            errors.push(name + ' is required');
            return;
          }
          let value = raw;
          if (property.type === 'number' || property.type === 'integer') value = Number(raw);
          if (property.type === 'boolean') value = Boolean(raw);
          if (property.type === 'integer' && !Number.isInteger(value)) errors.push(name + ' must be an integer');
          if (property.type === 'number' && typeof value === 'number' && !Number.isFinite(value)) errors.push(name + ' must be a number');
          if (typeof value === 'number' && property.minimum !== undefined && value < property.minimum) errors.push(name + ' must be at least ' + property.minimum);
          if (typeof value === 'number' && property.maximum !== undefined && value > property.maximum) errors.push(name + ' must be at most ' + property.maximum);
          if (property.enum && !property.enum.includes(value)) errors.push(name + ' has an invalid value');
          payload[name] = value;
        });
      } else if (fields.length) {
        const field = fields[0];
        const raw = field.type === 'checkbox' ? field.checked : field.value.trim();
        if (raw === '' && method === 'PUT') errors.push('input is required');
        if (raw) {
          payload = schema && schema.type === 'boolean'
            ? Boolean(raw)
            : schema && (schema.type === 'number' || schema.type === 'integer')
              ? Number(raw)
              : raw;
          if (schema && schema.type === 'number' && !Number.isFinite(payload)) errors.push('input must be a number');
          if (schema && schema.type === 'integer' && !Number.isInteger(payload)) errors.push('input must be an integer');
          if (schema && schema.minimum !== undefined && payload < schema.minimum) errors.push('input must be at least ' + schema.minimum);
          if (schema && schema.maximum !== undefined && payload > schema.maximum) errors.push('input must be at most ' + schema.maximum);
          if (schema && schema.enum && !schema.enum.includes(payload)) errors.push('input has an invalid value');
        }
      }
      if (errors.length) {
        result.className = 'result validation-error';
        result.textContent = errors.join('\\n');
        return;
      }
      if (payload !== undefined) {
        options.headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(payload);
      }
      result.className = 'result';
      result.textContent = 'Requesting...';
      try {
        const response = await fetch(form.dataset.endpoint, options);
        const text = await response.text();
        const status = response.status + ' ' + response.statusText;
        let formattedText = text;
        try {
          formattedText = text ? JSON.stringify(JSON.parse(text), null, 2) : '';
        } catch {
          // Keep non-JSON responses as text.
        }
        result.textContent = formattedText
          ? status + '\\n' + formattedText
          : status + (response.status === 204 ? '\\nRequest completed successfully.' : '');
      } catch (error) {
        result.textContent = 'Request failed: ' + error.message;
      }
    });
  });
</script>
</body>
</html>`;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(page);
}

function acceptsHtml(req: IncomingMessage): boolean {
  return (req.headers.accept || '').split(',').some(value => {
    const [mediaType, ...parameters] = value.trim().split(';');
    const quality = parameters.find(parameter => parameter.trim().startsWith('q='));
    return mediaType === 'text/html' && quality !== 'q=0' && quality !== 'q=0.0';
  });
}

function frontendContentType(pathname: string): string {
  const extension = pathname.split('.').pop()?.toLowerCase();
  const types: Record<string, string> = {
    css: 'text/css; charset=utf-8',
    html: 'text/html; charset=utf-8',
    js: 'text/javascript; charset=utf-8',
    json: 'application/json; charset=utf-8',
    png: 'image/png',
    svg: 'image/svg+xml',
    webp: 'image/webp',
    woff: 'font/woff',
    woff2: 'font/woff2'
  };
  return types[extension || ''] || 'application/octet-stream';
}

// Text assets are worth compressing; images, fonts and wasm are already packed.
const compressibleTypes = /^(text\/|application\/(javascript|json|xml)|image\/svg)/;

// Below about a kilobyte the framing costs more than the compression saves.
const compressionThreshold = 1024;

type FrontendAsset = { contentType: string; identity: Buffer; gzip?: Buffer; brotli?: Buffer; mtime: number; size: number };

// Each file is read — and compressed — at most once per version, and every
// later request is answered from this map. Without it, Brotli would run on
// every page load.
//
// The entry is stamped with the file's mtime and size, because the build is not
// immutable during development: `bun run frontend:build` rewrites dist while the
// lab is running, and a cache with no revalidation would keep serving the
// previous index.html — and therefore the previous, now-deleted asset hashes —
// until the process was restarted.
const frontendCache = new Map<string, FrontendAsset>();

function negotiateEncoding(req: IncomingMessage): 'br' | 'gzip' | null {
  const accepted = String(req.headers['accept-encoding'] || '').toLowerCase();
  if (accepted.includes('br')) {
    return 'br';
  }
  if (accepted.includes('gzip')) {
    return 'gzip';
  }
  return null;
}

// Vite fingerprints everything under /assets/, so those URLs can never change
// content and earn a year of immutable caching. index.html is the mutable entry
// point naming them, so it must be revalidated on every load.
function cacheControlFor(relativePath: string): string {
  return relativePath.startsWith('assets/')
    ? 'public, max-age=31536000, immutable'
    : 'no-cache';
}

async function loadFrontendAsset(relativePath: string): Promise<FrontendAsset | null> {
  const file = Bun.file(`${process.cwd()}/frontend/dist/${relativePath}`);
  if (!(await file.exists())) {
    return null;
  }

  const cached = frontendCache.get(relativePath);
  if (cached && cached.mtime === file.lastModified && cached.size === file.size) {
    return cached;
  }

  const identity = Buffer.from(await file.arrayBuffer());
  const contentType = frontendContentType(relativePath);
  const asset: FrontendAsset = {
    contentType,
    identity,
    mtime: file.lastModified,
    size: file.size
  };

  if (compressibleTypes.test(contentType) && identity.byteLength >= compressionThreshold) {
    asset.gzip = gzipSync(identity);
    // Quality 5 rather than the default 11: it lands within a few percent of
    // maximum Brotli on these bundles for a fraction of the time, which matters
    // because the first request for each asset pays for it.
    asset.brotli = brotliCompressSync(identity, {
      params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5 }
    });
  }

  frontendCache.set(relativePath, asset);
  return asset;
}

async function serveFrontend(req: IncomingMessage, pathname: string, res: ServerResponse): Promise<boolean> {
  const relativePath = pathname === '/' ? 'index.html' : pathname.slice(1);
  if (relativePath.includes('..') || relativePath.includes('\\')) {
    return false;
  }

  const asset = await loadFrontendAsset(relativePath);
  if (!asset) {
    return false;
  }

  const encoding = negotiateEncoding(req);
  const body = encoding === 'br' ? asset.brotli : encoding === 'gzip' ? asset.gzip : undefined;
  const headers: Record<string, string> = {
    'Content-Type': asset.contentType,
    'Content-Length': String((body ?? asset.identity).byteLength),
    'Cache-Control': cacheControlFor(relativePath),
    // The same URL can answer with different encodings, so shared caches must
    // key on the request's Accept-Encoding rather than the URL alone.
    Vary: 'Accept-Encoding'
  };
  if (body) {
    headers['Content-Encoding'] = encoding as string;
  }

  res.writeHead(200, headers);
  res.end(body ?? asset.identity);
  return true;
}

function renderIndex(things: ThingMap, html: boolean, port: number, res: ServerResponse): void {
  const entries = [...things.values()].map(thing => ({
    id: thingId(thing),
    title: thingDescription(thing).title || thingId(thing),
    description: thingDescription(thing).description,
    href: `http://localhost:${port}/${encodeURIComponent(thingId(thing))}`
  }));

  if (!html) {
    writeJson(res, { things: entries });
    return;
  }

  const rows = entries.map(entry =>
    `<tr><td><a href="/${encodeURIComponent(entry.id)}">${escapeHtml(entry.id)}</a></td>` +
    `<td>${escapeHtml(entry.title)}</td><td><a href="${entry.href}">Thing Description</a></td></tr>`
  ).join('');
  writeHtml(res, 'Things', `<nav><a href="/">WoT Lab</a></nav><h1>Things</h1>` +
    `<p>Exposed Web of Things resources.</p><table><thead><tr><th>Thing ID</th><th>Title</th><th>Resource</th></tr></thead>` +
    `<tbody>${rows || '<tr><td colspan="3">No Things are exposed.</td></tr>'}</tbody></table>`);
}

function renderThing(thing: WoT.ExposedThing, html: boolean, res: ServerResponse): void {
  const id = thingId(thing);
  const title = thingDescription(thing).title || id;
  const endpoints = endpointsForThing(thing);
  if (!html) {
    writeJson(res, {
      id,
      title: thingDescription(thing).title || id,
      endpoints: endpoints.map(endpoint => ({ ...endpoint, href: endpoint.href }))
    });
    return;
  }

  const renderActionInput = (input: unknown): string => {
    if (!input) {
      return '';
    }
    const schema = input as Schema;
    const properties = schema.type === 'object' ? Object.entries(schema.properties || {}) : [];
    if (properties.length) {
      const required = new Set(schema.required || []);
      const controls = properties.map(([name, property]) => {
        const fieldId = `field-${encodeURIComponent(name)}`;
        const requiredAttribute = required.has(name) ? ' required' : '';
        const bounds = [
          property.minimum !== undefined ? ` min="${property.minimum}"` : '',
          property.maximum !== undefined ? ` max="${property.maximum}"` : ''
        ].join('');
        const value = property.default !== undefined ? String(property.default) : '';
        let control = `<input id="${fieldId}" data-field="${escapeHtml(name)}" type="text" value="${escapeHtml(value)}"${requiredAttribute}${bounds}>`;
        if (property.enum) {
          const options = property.enum.map(option =>
            `<option value="${escapeHtml(String(option))}"${option === property.default ? ' selected' : ''}>${escapeHtml(String(option))}</option>`
          ).join('');
          control = `<select id="${fieldId}" data-field="${escapeHtml(name)}"${requiredAttribute}>${options}</select>`;
        } else if (property.type === 'boolean') {
          control = `<input id="${fieldId}" data-field="${escapeHtml(name)}" type="checkbox"${property.default === true ? ' checked' : ''}>`;
        } else if (property.type === 'number' || property.type === 'integer') {
          control = `<input id="${fieldId}" data-field="${escapeHtml(name)}" type="number" step="${property.type === 'integer' ? '1' : 'any'}" value="${escapeHtml(value)}"${requiredAttribute}${bounds}>`;
        }
        return `<label for="${fieldId}">${escapeHtml(name)}${required.has(name) ? ' (required)' : ''}${property.description ? `: ${escapeHtml(property.description)}` : ''}${control}</label>`;
      }).join('');
      return controls;
    }
    const type = schema.type === 'number' || schema.type === 'integer'
      ? 'number'
      : schema.type === 'boolean'
        ? 'checkbox'
        : 'text';
    const step = schema.type === 'integer' ? ' step="1"' : '';
    const value = schema.default !== undefined ? String(schema.default) : '';
    const checked = schema.type === 'boolean' && schema.default === true ? ' checked' : '';
    return `<label>Value<input data-field="value" type="${type}"${step}${schema.type === 'boolean' ? checked : ` value="${escapeHtml(value)}"`}></label>`;
  };

  const rows = endpoints.map(endpoint =>
    `<tr><td class="method">${endpoint.method}</td><td><details><summary><code>${escapeHtml(endpoint.href)}</code></summary>` +
    `<form data-endpoint-form data-endpoint="${escapeHtml(endpoint.href)}" data-method="${endpoint.method}"${endpoint.input ? ` data-schema="${escapeHtml(JSON.stringify(endpoint.input))}"` : ''}>` +
    (endpoint.method === 'POST' || endpoint.method === 'PUT' ? renderActionInput(endpoint.input) : '') +
    `<button type="submit">Send request</button><pre class="result" aria-live="polite"></pre></form></details></td>` +
    `<td>${escapeHtml(endpoint.name)}</td><td>${escapeHtml(endpoint.description)}</td></tr>`
  ).join('');
  writeHtml(res, title, `<nav><a href="/">WoT Lab</a> / ${escapeHtml(id)}</nav>` +
    `<h1>${escapeHtml(title)}</h1><p>REST-shaped WoT affordances for <code>${escapeHtml(id)}</code>.</p>` +
    `<table><thead><tr><th>Method</th><th>Endpoint</th><th>Operation</th><th>Description</th></tr></thead><tbody>${rows}</tbody></table>`);
}

/**
 * Serve a product resource, or the list of them.
 *
 * `GET /products` lists what exists; `GET /products/<id>` is one product's current
 * state. Read-only, because a product's state is a consequence: a station's recipe
 * puts it where it is, and a client that could write it directly would be able to
 * conjure a part out of nothing. Which is also why there is no POST — bringing a
 * product into existence is what a station's Action does.
 *
 * The state comes from `globalState`, the same store a station's `vre:effects`
 * writes through, so a read here sees what the last recipe left.
 */
function serveResource(req: IncomingMessage, segments: string[], res: ServerResponse): boolean {
  const states = globalState.things as Record<string, Record<string, unknown>>;
  const [, id] = segments;

  if (id === undefined) {
    writeJson(res, {
      products: resourceIdList()
        .filter(name => states[name])
        .map(name => ({ id: name, href: `/${resourcePrefix}/${encodeURIComponent(name)}` }))
    });
    return true;
  }

  const normalized = normalizeThingId(decodeSegment(id));
  if (!isResourceId(normalized) || !states[normalized]) {
    writeJson(res, { error: `Unknown product '${decodeSegment(id)}'` }, 404);
    return true;
  }
  // Turtle unless the client asked for JSON: a product is data about a physical
  // item, and what reads it also reads the records in the pod.
  if (wantsJson(req)) {
    // Serialised through JSON to detach the Valtio proxy the state is held in,
    // which is what the rest of the lab does when it hands state outwards.
    writeJson(res, JSON.parse(JSON.stringify(states[normalized])));
    return true;
  }
  writeTurtle(res, productTurtle(normalized, currentRunContainer()) as string);
  return true;
}

/**
 * Whether the client asked for JSON specifically.
 *
 * Turtle is the default, so only an `Accept` that names a JSON type and does not
 * name Turtle gets JSON — a browser sending `*\/*` gets the representation the
 * resource is defined in.
 */
function wantsJson(req: IncomingMessage): boolean {
  const accept = (req.headers.accept ?? '').toLowerCase();
  return /application\/(ld\+)?json/.test(accept) && !accept.includes('text/turtle');
}

function writeTurtle(res: ServerResponse, body: string): void {
  res.writeHead(200, {
    'Content-Type': 'text/turtle; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

/**
 * Percent-decode a path segment, falling back to the raw segment.
 *
 * `new URL()` neither normalises nor rejects a malformed escape, so a segment can
 * be `%` or `%e0%a4%a`, on which `decodeURIComponent` throws. A request with a
 * path the lab cannot decode is still a request it must answer, and one of the
 * two callers runs inside a `finish` hook where a throw has nothing above it to
 * catch and would take the process down.
 */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Which WoT operation, if any, a request path and method name.
 *
 * Only the affordance routes count: a Thing Description fetch reads no state and
 * the dashboard's own pages are not interactions with a Thing at all. An
 * unrecognised shape returns `undefined` and is never reported.
 */
function operationFor(method: string, pathParts: string[]): WotOperation | undefined {
  const [thing, kind, , modifier] = pathParts;
  const named = pathParts.length > 2;

  // `_lab` and `_replay` are reserved prefixes, so a path under them addresses
  // no Thing however it is shaped.
  if (!thing || thing.startsWith('_')) {
    return undefined;
  }

  if (kind === 'properties') {
    if (modifier === 'observable') {
      return method === 'GET' ? 'observeproperty' : undefined;
    }
    if (pathParts.length > 3) {
      return undefined;
    }
    if (method === 'GET') {
      return named ? 'readproperty' : 'readallproperties';
    }
    if (method === 'PUT') {
      return named ? 'writeproperty' : 'writeallproperties';
    }
    return undefined;
  }
  if (kind === 'actions' && method === 'POST' && pathParts.length === 3) {
    return 'invokeaction';
  }
  if (kind === 'events' && method === 'GET' && pathParts.length === 3) {
    return 'subscribeevent';
  }
  return undefined;
}

/**
 * Who the request says it is: the agent URI it named, or, naming none, the
 * address it came from. A provenance log without an agent answers half the
 * question it exists to answer, so the address stands in rather than nothing.
 */
function agentFor(req: IncomingMessage): RequestAgent | undefined {
  const header = req.headers[agentHeaderName()];
  const named = (Array.isArray(header) ? header[0] : header)?.trim();
  if (named) {
    return isAgentIri(named) ? { iri: named } : { id: named };
  }
  const address = req.socket.remoteAddress;
  return address ? { address } : undefined;
}

// A body is recorded so a log says what was asked for and not merely that
// something was. 64 KiB is far past any WoT affordance input, and it is the limit
// that bounds all of this: the lab holds at most this much per request in flight,
// reads no larger body at all, and so never records a partial one.
const maxCapturedBodyBytes = 64 * 1024;

/**
 * Decode a recorded body as text, or nothing when it is not text.
 *
 * Bytes that are not UTF-8 are left out: a Turtle literal that does not read
 * back as what arrived is worse than no literal at all.
 */
function decodeBody(buffer: Buffer): string | undefined {
  const text = buffer.toString('utf8');
  return Buffer.from(text, 'utf8').equals(buffer) ? text : undefined;
}

/**
 * Make a request that has already been read replay its body to whoever
 * subscribes to it next.
 *
 * node-wot reads a body exactly once, with `on('data')`, `on('end')` and
 * `on('error')` — every route funnels through `Content.toBuffer()`. Subscribing
 * is therefore the signal that it wants the body, and the recorded one is handed
 * over instead of the drained stream. The request object is what node-wot is
 * given, so the replay has to live on it; there is nothing else to substitute.
 */
function replayBody(req: IncomingMessage, read: () => Buffer | undefined): void {
  let delivered = false;

  const deliver = (): void => {
    if (delivered) {
      return;
    }
    delivered = true;
    // Deferred, because a consumer registers its `data`, `error` and `end`
    // listeners one after another: emitting from inside the first registration
    // would reach a consumer not yet listening for the end of what it asked for.
    void Promise.resolve().then(() => {
      const buffer = read();
      if (!buffer) {
        req.emit('error', new Error('The request ended before its body arrived'));
        return;
      }
      if (buffer.byteLength) {
        req.emit('data', buffer);
      }
      req.emit('end');
    });
  };

  type Subscribe = (
    // eslint-disable-next-line no-unused-vars
    event: string | symbol,
    // eslint-disable-next-line no-unused-vars
    listener: (..._args: never[]) => void
  ) => IncomingMessage;

  for (const name of ['on', 'once', 'addListener'] as const) {
    const subscribe = req[name].bind(req) as Subscribe;
    // The original is still what registers the listener — `once` keeps removing
    // its listener, and nothing but the extra trigger changes.
    const patched: Subscribe = (event, listener) => {
      const result = subscribe(event, listener);
      if (event === 'data' || event === 'end') {
        deliver();
      }
      return result;
    };
    req[name] = patched as typeof req[typeof name];
  }
}

/**
 * Read the request body, and return it as it will be recorded.
 *
 * Read here, and awaited before node-wot is handed the request, because a body
 * nobody reads does not survive the response: Bun's HTTP server discards what is
 * left of a request once its response is sent, and most Actions never look at
 * their input. Recording only the bodies a Thing happened to care about would
 * leave the log silent about exactly the requests that changed something.
 *
 * Waiting for the body is what a Thing that reads its input already makes the
 * lab do, and the request cannot outlast the server's own request timeout, so
 * this adds no way for a client to hold an affordance open.
 */
async function captureRequestBody(req: IncomingMessage): Promise<string | undefined> {
  const chunks: Buffer[] = [];
  let complete = false;

  const arrived = new Promise<void>(resolve => {
    req.on('data', (chunk: Buffer | string) => {
      // Copied, because a chunk is a view on a socket buffer that is reused as
      // soon as it has been handed on.
      chunks.push(Buffer.from(chunk));
    });
    req.once('end', () => {
      complete = true;
      resolve();
    });
    // A request that closes or fails before its end has no body to record, and
    // nothing whole to replay; node-wot is told as much when it asks.
    req.once('close', () => resolve());
    req.once('error', () => resolve());
  });

  // Installed after this module's own listeners, so subscribing above does not
  // trigger the replay it is meant to feed.
  replayBody(req, () => (complete ? Buffer.concat(chunks) : undefined));
  await arrived;

  const captured = complete ? Buffer.concat(chunks) : undefined;
  return captured?.byteLength ? decodeBody(captured) : undefined;
}

// Only a request that announced a body the lab is willing to hold is read for
// one. A chunked body announces no size, and a larger one is not worth the
// memory; both are left to stream to node-wot untouched, and go unrecorded
// rather than partly recorded.
const methodsWithBody = new Set(['POST', 'PUT', 'PATCH']);

function hasCapturableBody(req: IncomingMessage): boolean {
  if (!methodsWithBody.has(req.method ?? 'GET')) {
    return false;
  }
  const length = Number(req.headers['content-length']);
  return Number.isInteger(length) && length > 0 && length <= maxCapturedBodyBytes;
}

/**
 * Arrange for the provenance of one interaction to be posted to the pod.
 *
 * Hooked on `finish` rather than posted here: this middleware runs before
 * node-wot handles the request, so neither the state that matters nor the status
 * exists yet. `finish` and not `close`, so an aborted request — a long-poll
 * observation the client walked away from — records nothing; it changed nothing
 * either.
 */
async function reportInteraction(
  req: IncomingMessage,
  res: ServerResponse,
  pathParts: string[],
  requestUrl: URL
): Promise<void> {
  if (!isStateSinkEnabled()) {
    return;
  }
  const method = req.method ?? 'GET';
  const operation = operationFor(method, pathParts);
  if (!operation) {
    return;
  }

  // Taken before node-wot sees the request: the activity started when the
  // request arrived, not when the lab got around to it. The agent too — it is
  // read from the request, and by the time the response has finished the socket
  // it came from may be gone.
  const startedAt = new Date();
  // Which products exist before the request is handled, so the record can name
  // the ones it produced.
  const productsBefore = existingProducts();
  const agent = agentFor(req);
  const body = hasCapturableBody(req) ? await captureRequestBody(req) : undefined;

  // Wrapped because this runs from an event emitter: a throw here propagates out
  // of `emit` into node's HTTP machinery, which neither awaits nor catches this
  // middleware, so it would reach the process as an uncaught exception. Recording
  // is bookkeeping, and bookkeeping must not be able to kill the lab.
  res.once('finish', () => {
    try {
      publishThingState({
        thingId: decodeSegment(pathParts[0]),
        operation,
        method,
        requestUri: requestUrl.href,
        body,
        agent,
        status: res.statusCode,
        startedAt,
        endedAt: new Date()
      }, productsBefore);
    } catch (cause) {
      warn(`Could not record the interaction: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  });
}

// The lab API handles its own routes for every method; `false` means it did not
// claim the request. It is passed as a getter because the HTTP server has to
// exist before the servient starts, and the registry only exists after.
export type LabRequestHandler = (
  // eslint-disable-next-line no-unused-vars
  req: IncomingMessage,
  // eslint-disable-next-line no-unused-vars
  res: ServerResponse,
  // eslint-disable-next-line no-unused-vars
  segments: string[],
  // eslint-disable-next-line no-unused-vars
  url: URL
) => Promise<boolean>;

export function createEndpointMiddleware(
  getThings: () => ThingMap,
  port: number,
  getLabHandler: () => LabRequestHandler | undefined = () => undefined
) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> => {
    const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathParts = requestUrl.pathname.split('/').filter(Boolean);

    // Every `next()` below hands the request to node-wot's own routes, which is
    // exactly the set of requests that reach a Thing: what this middleware
    // answers itself — the dashboard, its assets, the lab API — never does.
    const forwardToWot = async (): Promise<void> => {
      // Awaited, because recording a request body means reading it, and the
      // Thing has to be handed the body the client sent, not what is left of it.
      await reportInteraction(req, res, pathParts, requestUrl);
      next();
    };

    // Checked before the method filter and before any Thing lookup: this prefix
    // is reserved (see reservedNames), so it can never shadow a Thing.
    if (pathParts[0] === labPrefix) {
      const handleLab = getLabHandler();
      if (handleLab && await handleLab(req, res, pathParts.slice(1), requestUrl)) {
        return;
      }
      await forwardToWot();
      return;
    }

    // Like `_lab`, checked before the method filter and before any Thing lookup:
    // `products` is reserved (see reservedNames), so it shadows nothing.
    if (pathParts[0] === resourcePrefix) {
      if (req.method === 'GET' && serveResource(req, pathParts, res)) {
        return;
      }
      // A product's state is written by recipes, not by clients.
      writeJson(res, { error: 'A product resource is read-only' }, 405);
      return;
    }

    if (req.method !== 'GET') {
      await forwardToWot();
      return;
    }

    const things = getThings();

    if (pathParts.length === 0) {
      if (acceptsHtml(req) && await serveFrontend(req, '/', res)) {
        return;
      }
      renderIndex(things, acceptsHtml(req), port, res);
      return;
    }

    if (pathParts[0] === 'assets' && await serveFrontend(req, requestUrl.pathname, res)) {
      return;
    }

    // The dashboard's own pages. A Thing id cannot start with `_`, so like
    // `_lab` this can never shadow a Thing.
    if (pathParts[0] === '_replay' && acceptsHtml(req) && await serveFrontend(req, '/', res)) {
      return;
    }

    const thing = [...things.values()].find(candidate => thingId(candidate) === decodeSegment(pathParts[0]));
    if (thing && acceptsHtml(req)) {
      if (await serveFrontend(req, '/', res)) {
        return;
      }
      renderThing(thing, true, res);
      return;
    }

    await forwardToWot();
  };
}