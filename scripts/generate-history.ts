/**
 * Generate a history: N smartphones built over the last few days, each with the
 * full trace of the run that made it.
 *
 * The lab already builds what a pod's `orders/` container asks for, and an order
 * that carries a date is built now and recorded as having been built then. So the
 * whole job is to put N dated orders in the container — the lab does the building,
 * the numbering and the tracing. Orders are named in date order, because the lab
 * builds a container's orders in name order and the serials should then read
 * chronologically too.
 *
 *   bun scripts/generate-history.ts --container https://pod.example.org/alice/wot-lab/ --wait
 *
 * The lab has to be running against the same container, with an environment that
 * has a plan for a finished product (`--env mosaik`). Credentials are read the way
 * the lab reads them: `WOT_LAB_SOLID_CLIENT_ID` / `WOT_LAB_SOLID_CLIENT_SECRET`,
 * from the environment or `.env`; without them the pod is written as the public.
 *
 * Re-running is safe: an order is only ever created, never overwritten, so one
 * already in the pod — built or not — is left as it is and counted as skipped.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { createDpopFetch, SolidFetch } from '../src/solid/dpopFetch.js';

const { values } = parseArgs({
  options: {
    container: { type: 'string' },
    count: { type: 'string', default: '150' },
    days: { type: 'string', default: '3' },
    'lab-url': { type: 'string', default: 'http://localhost:8081' },
    seed: { type: 'string', default: '1' },
    prefix: { type: 'string', default: 'history' },
    'dry-run': { type: 'boolean', default: false },
    wait: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false }
  }
});

const usage = `generate-history: put N dated smartphone orders in a Solid pod

  --container <url>  the pod container the lab works against (or WOT_LAB_SOLID_CONTAINER)
  --count <n>        smartphones to generate (default 150)
  --days <n>         spread them over the last n days (default 3)
  --lab-url <url>    where the lab is served; orders name products by it (default http://localhost:8081)
  --seed <n>         makes the schedule and the choice of phones repeatable (default 1)
  --prefix <name>    orders are <name>-0001.ttl, <name>-0002.ttl, ... (default history)
  --dry-run          print the schedule and write nothing
  --wait             after writing, wait until the lab has built every order`;

if (values.help) {
  console.log(usage);
  process.exit(0);
}

function fail(message: string): never {
  console.error(`ERROR: ${message}\n\n${usage}`);
  process.exit(1);
}

function positive(name: string, raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    fail(`--${name} must be a positive number, got '${raw}'`);
  }
  return n;
}

const count = Math.floor(positive('count', values.count as string));
const days = positive('days', values.days as string);
const seed = Math.floor(positive('seed', values.seed as string));
const labUrl = (values['lab-url'] as string).replace(/\/+$/, '');
const prefix = values.prefix as string;
if (!/^[A-Za-z0-9_-]+$/.test(prefix)) {
  fail(`--prefix must be letters, digits, - or _, got '${prefix}'`);
}

const containerArg = values.container ?? process.env.WOT_LAB_SOLID_CONTAINER;
if (!containerArg && !values['dry-run']) {
  fail('no pod: give --container or set WOT_LAB_SOLID_CONTAINER');
}
let ordersContainer = '';
if (containerArg) {
  let url: URL;
  try {
    url = new URL(containerArg);
  } catch {
    fail(`--container '${containerArg}' is not a URL`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    fail(`--container '${containerArg}' must be http(s)`);
  }
  ordersContainer = `${url.pathname.endsWith('/') ? url.href : `${url.href}/`}orders/`;
}

// A small deterministic generator, so the same seed gives the same history.
function mulberry32(start: number): () => number {
  let state = start >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(seed);

// The bundled examples are the templates: one per phone, each already a complete
// order. Only its date and the lab's address change.
const templateDir = join(import.meta.dir, '..', 'orders');
const datePattern = /(schema:orderDate\s+)"[^"]*"(\^\^xsd:dateTime)/;
const templates = readdirSync(templateDir)
  .filter(file => file.endsWith('.ttl'))
  .sort()
  .map(file => ({ file, text: readFileSync(join(templateDir, file), 'utf8') }));
if (!templates.length) {
  fail(`no order templates in ${templateDir}`);
}
for (const { file, text } of templates) {
  if (!datePattern.test(text)) {
    fail(`${file} has no schema:orderDate to replace`);
  }
}

// One slot per phone, a random moment within each: evenly spread without being
// evenly spaced. The last moment stays a minute short of now, because a build
// takes a moment and a phone finished in the future is no history.
const now = Date.now();
const end = now - 60_000;
const start = now - days * 86_400_000;
const slot = (end - start) / count;
const orders = Array.from({ length: count }, (_, index) => {
  const placed = new Date(Math.round(start + (index + random()) * slot));
  const template = templates[Math.floor(random() * templates.length)];
  const number = String(index + 1).padStart(Math.max(4, String(count).length), '0');
  return {
    name: `${prefix}-${number}.ttl`,
    phone: template.file.replace(/^order_|\.ttl$/g, ''),
    placed,
    body: template.text
      .replace(datePattern, `$1"${placed.toISOString()}"$2`)
      .split('http://localhost:8081').join(labUrl)
  };
});

const perPhone = new Map<string, number>();
for (const { phone } of orders) {
  perPhone.set(phone, (perPhone.get(phone) ?? 0) + 1);
}
console.log(`${count} smartphones, ${orders[0].placed.toISOString()} .. ${orders[count - 1].placed.toISOString()}`);
console.log([...perPhone].sort().map(([phone, n]) => `  ${String(n).padStart(3)}  ${phone}`).join('\n'));
if (values['dry-run']) {
  console.log(`\nDry run: nothing written. Would create ${ordersContainer || '<container>/orders/'}${prefix}-*.ttl`);
  process.exit(0);
}

const clientId = process.env.WOT_LAB_SOLID_CLIENT_ID;
const clientSecret = process.env.WOT_LAB_SOLID_CLIENT_SECRET;
const send: SolidFetch = clientId && clientSecret
  ? createDpopFetch({ server: new URL(ordersContainer).origin, clientId, clientSecret })
  : fetch;

const requestTimeoutMs = 30_000;

// Created, never overwritten: `If-None-Match: *` makes the pod refuse an order
// that is already there, so a second run neither rewinds a built order's marking
// nor has the lab build the same phone twice.
let created = 0;
let skipped = 0;
for (const [index, order] of orders.entries()) {
  const response = await send(`${ordersContainer}${order.name}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/turtle', 'If-None-Match': '*' },
    body: order.body,
    signal: AbortSignal.timeout(requestTimeoutMs)
  });
  if (response.ok) {
    created += 1;
  } else if (response.status === 412) {
    skipped += 1;
  } else {
    const detail = (await response.text().catch(() => '')).slice(0, 200);
    console.error(`ERROR: ${order.name}: ${response.status} ${response.statusText} ${detail}`);
    process.exit(1);
  }
  if ((index + 1) % 25 === 0 || index + 1 === count) {
    console.log(`  wrote ${index + 1}/${count}`);
  }
}
console.log(`Created ${created} order(s), skipped ${skipped} already in the pod, in ${ordersContainer}`);

if (!values.wait) {
  console.log('The lab builds them in date order, a few seconds apart; add --wait to follow it.');
  process.exit(0);
}

// The lab builds a container's orders in name order, which is the order they were
// named in — so only the first unbuilt one needs asking about.
const fulfilled = 'https://example.org/passport/fulfilled>';
const pollMs = 3_000;
let built = 0;
let lastProgress = Date.now();
let hinted = false;
console.log('Waiting for the lab to build them...');
while (built < count) {
  const response = await send(`${ordersContainer}${orders[built].name}`, {
    headers: { Accept: 'text/turtle' },
    signal: AbortSignal.timeout(requestTimeoutMs)
  }).catch(() => undefined);
  if (response?.ok && (await response.text()).includes(fulfilled)) {
    built += 1;
    lastProgress = Date.now();
    if (built % 10 === 0 || built === count) {
      console.log(`  built ${built}/${count}`);
    }
    continue;
  }
  if (!hinted && Date.now() - lastProgress > 120_000) {
    console.warn(`No order built for 2 minutes. Is the lab running against ${ordersContainer.replace(/orders\/$/, '')} with --env mosaik, on ${labUrl}?`);
    hinted = true;
  }
  await new Promise(resolve => setTimeout(resolve, pollMs));
}
console.log(`Done: ${count} smartphones built.`);
