import { IncomingMessage, ServerResponse } from 'http';
import { URL } from 'url';
import * as WoT from 'wot-typescript-definitions';

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

function writeJson(res: ServerResponse, value: unknown): void {
  const body = JSON.stringify(value, null, 2);
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
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

function renderIndex(things: ThingMap, html: boolean, port: number, res: ServerResponse): void {
  const entries = [...things.values()].map(thing => ({
    id: thingId(thing),
    title: thingDescription(thing).title || thingId(thing),
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

export function createEndpointMiddleware(getThings: () => ThingMap, port: number) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> => {
    if (req.method !== 'GET') {
      next();
      return;
    }

    const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathParts = requestUrl.pathname.split('/').filter(Boolean);
    const things = getThings();

    if (pathParts.length === 0) {
      renderIndex(things, acceptsHtml(req), port, res);
      return;
    }

    const thing = [...things.values()].find(candidate => thingId(candidate) === decodeURIComponent(pathParts[0]));
    if (thing && acceptsHtml(req)) {
      renderThing(thing, true, res);
      return;
    }

    next();
  };
}