import { IncomingMessage, ServerResponse } from 'http';
import { URL } from 'url';
import * as WoT from 'wot-typescript-definitions';

interface Endpoint {
  name: string;
  method: string;
  href: string;
  description: string;
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
      description: action.description || 'Invoke an action'
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
  </style>
</head>
<body><main>${body}</main></body>
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

  const rows = endpoints.map(endpoint =>
    `<tr><td class="method">${endpoint.method}</td><td><a href="${endpoint.href}"><code>${endpoint.href}</code></a></td>` +
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