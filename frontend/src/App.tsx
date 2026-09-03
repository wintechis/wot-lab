import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  BaseStyles,
  Button,
  Checkbox,
  ConfirmationDialog,
  CounterLabel,
  Flash,
  Heading,
  IconButton,
  Label,
  Link,
  NavList,
  PageLayout,
  RelativeTime,
  Select,
  Spinner,
  Stack,
  Text,
  TextInput,
  ThemeProvider,
  ToggleSwitch,
  UnderlineNav
} from '@primer/react';
import {
  BeakerIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  DashIcon,
  DeviceDesktopIcon,
  LinkExternalIcon,
  MoonIcon,
  PlayIcon,
  PlusIcon,
  SunIcon,
  SyncIcon,
  TrashIcon
} from '@primer/octicons-react';

import {
  LabThing,
  ThingModel,
  apiBase,
  apiUrl,
  labThingModels,
  labThings,
  removeThing,
  requestJson
} from './api';
import { HighlightedJson, InlineCode, JsonBlock } from './Json';
import { CreateThingDialog } from './CreateThing';

type ThingEntry = { id: string; title: string; href: string; description?: string };

// Every TD node keeps its `[term: string]: unknown` index signature on purpose.
// The named members below are the terms this UI gives a dedicated control; the
// index signature is what lets everything else — a vendor extension like
// `vre:effects`, or a TD term standardised after this was written — survive as
// far as the renderer, which falls back to <ExtraTerms> for it. Narrowing these
// types to a fixed allowlist is what previously made the inspector lossy.
type TdNode = Record<string, unknown>;

// A protocol binding: where an operation lives and how to speak to it.
type Form = { href: string; op?: string | string[]; contentType?: string; subprotocol?: string; 'htv:methodName'?: string; [term: string]: unknown };
type TdLink = { href?: string; rel?: string; type?: string; sizes?: string; [term: string]: unknown };
type SecurityScheme = { scheme?: string; description?: string; in?: string; name?: string; [term: string]: unknown };

type Schema = {
  type?: string; title?: string; description?: string; unit?: string; '@type'?: string | string[];
  default?: unknown; const?: unknown; enum?: unknown[]; format?: string; pattern?: string;
  minimum?: number; maximum?: number; exclusiveMinimum?: number; exclusiveMaximum?: number; multipleOf?: number;
  minLength?: number; maxLength?: number; minItems?: number; maxItems?: number;
  readOnly?: boolean; writeOnly?: boolean; observable?: boolean;
  properties?: Record<string, Schema>; required?: string[]; items?: Schema;
  forms?: Form[];
  [term: string]: unknown;
};
type ActionNode = Schema & { input?: Schema; output?: Schema; safe?: boolean; idempotent?: boolean; synchronous?: boolean };
type EventNode = Schema & { data?: Schema; subscription?: Schema; cancellation?: Schema; dataResponse?: Schema };

type ThingDescription = {
  id?: string; title?: string; description?: string; base?: string;
  '@context'?: unknown; '@type'?: string | string[];
  securityDefinitions?: Record<string, SecurityScheme>; security?: string | string[];
  links?: TdLink[]; forms?: Form[];
  version?: unknown; created?: string; modified?: string; support?: string;
  properties?: Record<string, Schema>; actions?: Record<string, ActionNode>; events?: Record<string, EventNode>;
  [term: string]: unknown;
};

// Affordance models carry the terms the tables read directly *plus* `node`, the
// untouched TD entry the detail panel renders in full.
type Property = { name: string; title?: string; description?: string; schema: Schema; type: string; writable: boolean; observable: boolean; node: Schema };
type Action = { name: string; title?: string; description?: string; input?: Schema; output?: Schema; node: ActionNode };
type EventAffordance = { name: string; title?: string; description?: string; data?: Schema; node: EventNode };
// The parsed Thing Description an inspector renders. Distinct from a `ThingModel`
// in the W3C sense (the on-disk template a Thing is built from), which this app
// imports from ./api — hence the deliberately different name.
type InspectedThing = { id: string; title: string; description?: string; atType?: string; properties: Property[]; actions: Action[]; events: EventAffordance[]; context: TdContextValue; td: ThingDescription };

type ColorMode = 'auto' | 'light' | 'dark';

// --- Client-side routing -----------------------------------------------
// Real paths, not hashes: a Thing is /counter, and each affordance kind is its
// own sub-page at /counter/actions. The server serves this SPA for any path
// whose first segment is a Thing, so these deep links load directly.
// `td` is not an interaction affordance — it's the source document itself, the
// ground truth the other three tabs interpret.
const sections = ['properties', 'actions', 'events', 'td'] as const;
type Section = (typeof sections)[number];
const sectionLabel: Record<Section, string> = { properties: 'Properties', actions: 'Actions', events: 'Events', td: 'Thing Description' };
type Route = { thingId: string | null; section: Section | null };

function parseRoute(): Route {
  const segments = decodeURIComponent(window.location.pathname).replace(/^\/+/, '').split('/').filter(Boolean);
  const thingId = segments[0] || null;
  const kind = segments[1] as Section;
  return { thingId, section: thingId && sections.includes(kind) ? kind : null };
}

function useRoute() {
  const [route, setRoute] = useState<Route>(parseRoute);
  useEffect(() => {
    const sync = () => setRoute(parseRoute());
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  const navigate = useCallback((thingId: string | null, section: Section | null = null, options?: { replace?: boolean }) => {
    const url = thingId ? `/${encodeURIComponent(thingId)}${section ? `/${section}` : ''}` : '/';
    window.history[options?.replace ? 'replaceState' : 'pushState']({}, '', url);
    setRoute({ thingId, section });
  }, []);
  return { route, navigate };
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('aborted', 'AbortError')); }, { once: true });
  });
}

function modelFromDescription(description: ThingDescription, fallbackId: string): InspectedThing {
  const id = (description.id || fallbackId).replace('urn:wot:', '');
  const atTypeRaw = description['@type'];
  const properties: Property[] = Object.entries(description.properties || {}).map(([name, schema]) => ({
    name,
    title: schema.title,
    description: schema.description,
    schema,
    type: schema.type || 'unknown',
    // Writability is a protocol fact when the TD declares forms: a Thing is
    // writable exactly when it advertises a `writeproperty` operation. Fall back
    // to the `readOnly` term only for a TD served without forms (e.g. read from
    // disk), where there is nothing else to go on.
    writable: schema.forms?.length ? hasOp(schema.forms, 'writeproperty') : !schema.readOnly,
    observable: schema.observable === true,
    node: schema
  }));
  const actions: Action[] = Object.entries(description.actions || {}).map(([name, action]) => ({
    name, title: action.title, description: action.description, input: action.input, output: action.output, node: action
  }));
  const events: EventAffordance[] = Object.entries(description.events || {}).map(([name, event]) => ({
    name, title: event.title, description: event.description, data: event.data, node: event
  }));
  return {
    id,
    title: description.title || id,
    description: description.description,
    atType: Array.isArray(atTypeRaw) ? atTypeRaw.join(', ') : atTypeRaw,
    properties, actions, events,
    context: parseContext(description['@context']),
    td: description
  };
}

// --- @context: prefix resolution ----------------------------------------

// The `@context` of a TD is both a list of vocabulary IRIs and (in its object
// entries) a prefix map. Parsing it is what turns an opaque `qudtUnit:DEG_C`
// into a resolvable term, so semantic annotations stop reading as noise.
type TdContextValue = { vocabularies: string[]; prefixes: Record<string, string>; language?: string };

const emptyContext: TdContextValue = { vocabularies: [], prefixes: {} };

const TdContext = createContext<TdContextValue>(emptyContext);
const useTdContext = () => useContext(TdContext);

function parseContext(raw: unknown): TdContextValue {
  const vocabularies: string[] = [];
  const prefixes: Record<string, string> = {};
  let language: string | undefined;
  for (const entry of Array.isArray(raw) ? raw : [raw]) {
    if (typeof entry === 'string') { vocabularies.push(entry); continue; }
    if (!entry || typeof entry !== 'object') continue;
    for (const [term, value] of Object.entries(entry as Record<string, unknown>)) {
      if (term === '@language') { if (typeof value === 'string') language = value; continue; }
      if (typeof value === 'string') prefixes[term] = value;
    }
  }
  return { vocabularies, prefixes, language };
}

// "qudtUnit:DEG_C" → "https://qudt.org/vocab/unit/DEG_C" when @context maps the
// prefix; undefined for a plain string like "percent", which stays as written.
function expandIri(term: string, context: TdContextValue): string | undefined {
  const separator = term.indexOf(':');
  if (separator < 1) return undefined;
  if (/^https?$/i.test(term.slice(0, separator))) return term;
  const namespace = context.prefixes[term.slice(0, separator)];
  return namespace ? namespace + term.slice(separator + 1) : undefined;
}

// A compact IRI shown as written, linking out to its expansion when @context
// declares the prefix — so the annotation stays readable but stays checkable.
function SemanticTerm({ term }: { term: string }) {
  const expanded = expandIri(term, useTdContext());
  if (!expanded) return <Text className="mono">{term}</Text>;
  return <Link href={expanded} target="_blank" rel="noopener noreferrer" className="mono" title={expanded}>{term}</Link>;
}

// --- Forms: the protocol binding ----------------------------------------

const opList = (form: Form): string[] => Array.isArray(form.op) ? form.op : form.op ? [form.op] : [];
const hasOp = (forms: Form[] | undefined, op: string): boolean => (forms || []).some(form => opList(form).includes(op));

// The advertised href is bound to whichever interface node-wot picked
// (a LAN address, an IPv6 address, …), not the origin that served this page.
// Requests must therefore reuse only the *path* — same-origin, and still behind
// the Vite dev proxy — while the forms panel shows the full advertised href.
function formPath(href: string): string | undefined {
  try {
    const url = new URL(href, window.location.origin);
    return `${apiBase}${url.pathname}${url.search}`;
  } catch { return undefined; }
}

// Resolve an operation to a concrete request. Prefers the form the TD actually
// declares (JSON first — this client parses JSON), and falls back to wot-lab's
// conventional path so a TD served without forms keeps working.
type Resolved = { url: string; method: string; contentType: string; subprotocol?: string; declared: boolean };

function resolveOp(forms: Form[] | undefined, op: string, fallbackPath: string, fallbackMethod: string): Resolved {
  const matches = (forms || []).filter(form => opList(form).includes(op));
  const form = matches.find(candidate => (candidate.contentType || 'application/json').startsWith('application/json')) ?? matches[0];
  const path = form && formPath(form.href);
  return {
    url: path ?? apiUrl(fallbackPath),
    method: (typeof form?.['htv:methodName'] === 'string' ? form['htv:methodName'] : undefined) || fallbackMethod,
    contentType: form?.contentType || 'application/json',
    subprotocol: form?.subprotocol,
    declared: Boolean(path)
  };
}

// node-wot advertises the same operation once per bound network interface and
// per content type — twelve forms for one observable property. Collapse them to
// one row per (path, operation set), listing the content types and counting the
// hosts, so the panel shows the protocol surface instead of an address dump.
type FormSummary = { path: string; ops: string[]; method?: string; subprotocol?: string; contentTypes: string[]; hosts: string[]; href: string };

function summarizeForms(forms: Form[] | undefined): FormSummary[] {
  const grouped = new Map<string, FormSummary>();
  for (const form of forms || []) {
    let path = form.href;
    let host = '';
    try { const url = new URL(form.href); path = `${url.pathname}${url.search}`; host = url.host; } catch { /* keep raw href */ }
    const ops = opList(form);
    const key = `${path}|${ops.join(',')}|${form.subprotocol ?? ''}`;
    const existing = grouped.get(key);
    const method = typeof form['htv:methodName'] === 'string' ? form['htv:methodName'] : undefined;
    if (existing) {
      if (form.contentType && !existing.contentTypes.includes(form.contentType)) existing.contentTypes.push(form.contentType);
      if (host && !existing.hosts.includes(host)) existing.hosts.push(host);
      continue;
    }
    grouped.set(key, { path, ops, method, subprotocol: form.subprotocol, contentTypes: form.contentType ? [form.contentType] : [], hosts: host ? [host] : [], href: form.href });
  }
  return [...grouped.values()];
}

// Open the machine-readable Thing Description in a new tab. A plain link can't:
// a browser navigation sends Accept: text/html and the server returns this SPA,
// so fetch the JSON explicitly (Accept: application/json) and open it as a blob.
async function openThingDescription(id: string): Promise<void> {
  try {
    const td = await requestJson<unknown>(apiUrl(`/${encodeURIComponent(id)}`));
    const url = URL.createObjectURL(new Blob([JSON.stringify(td, null, 2)], { type: 'application/json' }));
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch { /* ignore — the overview already shows the id */ }
}

// True when a Thing's id carries nothing the title doesn't — i.e. it's just the
// title with case and separators (spaces/hyphens/underscores) stripped, as the
// auto-derived id usually is (title "Counter" → id "counter"). In that case the
// id is redundant next to the title and not worth showing.
function idEchoesTitle(id: string, title: string): boolean {
  const normalize = (value: string) => value.toLowerCase().replace(/[\s_-]+/g, '');
  return normalize(id) === normalize(title);
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null) return '—';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

// --- Provenance + type helpers -----------------------------------------

// A small monospace tag naming the Thing Description field a value comes from.
function FieldLabel({ children }: { children: React.ReactNode }) {
  return <Text as="span" className="field-label">{children}</Text>;
}

// A runtime value, rendered in the same tinted code chip the landing page uses
// for paths and TD terms. Values are data, and this is the one place the app
// says "this is data" — so a property reading, a nested member and an action's
// output all look the same wherever they appear.
// Absence is not a value: null/undefined stays a plain muted dash rather than an
// empty chip, which would read as a value that happens to be blank.
function ValueCode({ value, className }: { value: unknown; className?: string }) {
  if (value === undefined || value === null) {
    return <Text className={className ? `muted ${className}` : 'muted'}>{formatValue(value)}</Text>;
  }
  return <InlineCode className={className}>{formatValue(value)}</InlineCode>;
}

// A datatype is data, not status, so it reads as a tinted monospace word rather
// than a filled pill — the same language as the syntax-highlighted Thing
// Description, and it keeps the categorical hue without a column of blue
// lozenges. (`accent` covers number *and* integer, so a sensor Thing used to
// render an unbroken blue stack here.)
const typeColor: Record<string, string> = { boolean: 'done', integer: 'accent', number: 'accent', string: 'success', object: 'attention', array: 'severe' };

function TypeName({ type }: { type: string }) {
  return <Text as="span" className={`type-name type-${typeColor[type] ?? 'neutral'}`}>{type}</Text>;
}

// Consistent datatype rendering used by properties, action input/output and event data.
function TypeBadge({ schema }: { schema?: Schema }) {
  if (!schema || !schema.type) return <Text className="muted">—</Text>;
  return <Stack direction="horizontal" gap="condensed" align="baseline" wrap="wrap">
    <TypeName type={schema.type} />
    {schema.unit && <Text size="small" className="muted">{schema.unit}</Text>}
    {schema.enum && <Text size="small" className="muted">enum</Text>}
  </Stack>;
}

// Affordance name cell: the TD key (monospace, the addressable identifier) plus
// its human title when that adds something, and the description below.
function AffordanceName({ name, title, description, id }: { name: string; title?: string; description?: string; id?: string }) {
  const showTitle = title && title.toLowerCase() !== name.toLowerCase();
  return <Stack gap="none">
    <Text id={id} className="mono" weight="semibold">{name}</Text>
    {showTitle && <Text size="small">{title}</Text>}
    {description && <Text as="p" size="small" className="muted">{description}</Text>}
  </Stack>;
}

// --- Detail panel: everything the row itself has no column for ----------

// The terms each kind of node renders through a dedicated control. Anything
// outside these sets reaches <ExtraTerms> verbatim — that is the mechanism that
// keeps the inspector lossless as TDs grow terms this code has never seen.
const renderedTerms = {
  property: new Set(['title', 'description', 'type', 'unit', 'readOnly', 'writeOnly', 'observable', 'forms', '@type', 'properties', 'items', 'required',
    'default', 'const', 'enum', 'format', 'pattern', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'minItems', 'maxItems']),
  // `vre:effects` is wot-lab's own term and gets its own section, so it is
  // listed here to keep it out of the generic "other terms" fallback.
  action: new Set(['title', 'description', 'input', 'output', 'forms', '@type', 'safe', 'idempotent', 'synchronous', 'vre:effects']),
  event: new Set(['title', 'description', 'data', 'subscription', 'cancellation', 'dataResponse', 'forms', '@type'])
};

// Validation keywords, formatted for reading rather than for a form control:
// a paired minimum/maximum becomes one range, the rest stay individual facts.
function constraintList(schema: Schema): string[] {
  const out: string[] = [];
  const { minimum, maximum, exclusiveMinimum, exclusiveMaximum } = schema;
  if (minimum !== undefined && maximum !== undefined) out.push(`${minimum} – ${maximum}`);
  else if (minimum !== undefined) out.push(`≥ ${minimum}`);
  else if (maximum !== undefined) out.push(`≤ ${maximum}`);
  if (exclusiveMinimum !== undefined) out.push(`> ${exclusiveMinimum}`);
  if (exclusiveMaximum !== undefined) out.push(`< ${exclusiveMaximum}`);
  if (schema.multipleOf !== undefined) out.push(`multiple of ${schema.multipleOf}`);
  if (schema.minLength !== undefined) out.push(`min length ${schema.minLength}`);
  if (schema.maxLength !== undefined) out.push(`max length ${schema.maxLength}`);
  if (schema.minItems !== undefined) out.push(`min items ${schema.minItems}`);
  if (schema.maxItems !== undefined) out.push(`max items ${schema.maxItems}`);
  if (schema.pattern) out.push(`pattern ${schema.pattern}`);
  if (schema.format) out.push(`format ${schema.format}`);
  if (schema.const !== undefined) out.push(`const ${formatValue(schema.const)}`);
  if (schema.default !== undefined) out.push(`default ${formatValue(schema.default)}`);
  return out;
}

// Booleans read badly as pills. Half of them say "not safe" / "not observable"
// in grey — a lot of chrome to communicate an absence — and a row of filled
// shapes reads as more important than the value it sits next to. An icon column
// carries the state instead: the eye scans the ticks, and the words stay words.
function FlagList({ flags }: { flags: { label: string; on: boolean; hint?: string }[] }) {
  return <Stack direction="horizontal" gap="normal" wrap="wrap">
    {flags.map(flag => <Stack key={flag.label} direction="horizontal" gap="condensed" align="center"
      className={`flag${flag.on ? ' flag-on' : ''}`} title={flag.hint}>
      {flag.on ? <CheckIcon size={14} /> : <DashIcon size={14} />}
      <Text size="small">{flag.label}</Text>
    </Stack>)}
  </Stack>;
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <Stack gap="condensed" className="detail-section">
    <Text className="eyebrow" as="div">{title}</Text>
    {children}
  </Stack>;
}

// A labelled row of small facts (flags, constraints, enum members).
function ChipRow({ items }: { items: React.ReactNode[] }) {
  return <Stack direction="horizontal" gap="condensed" wrap="wrap" align="center">
    {items.map((item, index) => <span key={index}>{item}</span>)}
  </Stack>;
}

// The forms of one affordance, collapsed by summarizeForms. This is the part of
// the TD that says how to actually talk to the Thing — the operation, the HTTP
// method, the media types on offer and any subprotocol (longpoll) — and it had
// no representation at all in the previous inspector.
function FormsTable({ forms }: { forms?: Form[] }) {
  const summaries = summarizeForms(forms);
  if (!summaries.length) return <Text size="small" className="muted">No forms declared.</Text>;
  return <div className="table-scroll">
    <table className="detail-table">
      <thead><tr><th>Operation</th><th>Endpoint</th><th>Content types</th></tr></thead>
      <tbody>
        {summaries.map((summary, index) => <tr key={index}>
          <td><Stack gap="none">
            <Text className="mono op-name" size="small">{summary.ops.join(' · ')}</Text>
            {summary.subprotocol && <Text size="small" className="muted">via {summary.subprotocol}</Text>}
          </Stack></td>
          <td><Stack gap="none">
            <Text className="mono" size="small">{summary.method && <Text as="span" weight="semibold">{summary.method} </Text>}{summary.path}</Text>
            {summary.hosts.length > 0 && <Text size="small" className="muted" title={summary.hosts.join('\n')}>
              advertised on {summary.hosts.length === 1 ? summary.hosts[0] : `${summary.hosts.length} interfaces`}
            </Text>}
          </Stack></td>
          <td><ChipRow items={summary.contentTypes.map(contentType => <Text key={contentType} className="mono" size="small">{contentType}</Text>)} /></td>
        </tr>)}
      </tbody>
    </table>
  </div>;
}

// Renders one value of an unrecognised term. Multi-statement strings (a
// `vre:effects` body) read as code; structured values fall back to JSON, which
// is lossless even when this code has no idea what the term means.
function TermValue({ value }: { value: unknown }) {
  if (typeof value === 'string') {
    if (value.includes(';') || value.includes('\n')) return <pre className="term-code"><code>{value}</code></pre>;
    return <SemanticTerm term={value} />;
  }
  if (value === null || typeof value !== 'object') return <Text className="mono">{formatValue(value)}</Text>;
  return <JsonBlock className="term-code" source={JSON.stringify(value, null, 2)} />;
}

// The safety net: every term of the node that no dedicated control claimed.
function ExtraTerms({ node, rendered }: { node: TdNode; rendered: Set<string> }) {
  const extras = Object.entries(node).filter(([term]) => !rendered.has(term));
  if (!extras.length) return null;
  return <DetailSection title="Other Thing Description terms">
    <Stack gap="condensed">
      {extras.map(([term, value]) => <Stack key={term} gap="none" className="term-row">
        <FieldLabel>{term}</FieldLabel>
        <TermValue value={value} />
      </Stack>)}
    </Stack>
  </DetailSection>;
}

// Semantic @type annotations on an affordance, each resolved through @context.
function TypeAnnotations({ node }: { node: TdNode }) {
  const raw = node['@type'];
  const types = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter((value): value is string => typeof value === 'string');
  if (!types.length) return null;
  return <DetailSection title="Semantic type">
    <ChipRow items={types.map(type => <SemanticTerm key={type} term={type} />)} />
  </DetailSection>;
}

function DetailPanel({ children }: { children: React.ReactNode }) {
  return <div className="detail-panel"><Stack gap="normal">{children}</Stack></div>;
}

function ExpandButton({ expanded, onToggle, label }: { expanded: boolean; onToggle: () => void; label: string }) {
  return <IconButton icon={expanded ? ChevronDownIcon : ChevronRightIcon} variant="invisible" size="small"
    aria-label={`${expanded ? 'Hide' : 'Show'} Thing Description detail for ${label}`} aria-expanded={expanded} onClick={onToggle} />;
}

// --- Schema-driven inputs & outputs (recursive over object/array) -------

// A form value tree that mirrors the schema: leaves are strings/booleans while
// editing; objects/arrays nest. coerceTree turns it into the typed JSON to send.
type RawValue = string | boolean | RawValue[] | { [key: string]: RawValue };

function defaultRaw(schema?: Schema): RawValue {
  if (!schema) return '';
  if (schema.type === 'object') {
    return Object.fromEntries(Object.entries(schema.properties || {}).map(([key, propertySchema]) => [key, defaultRaw(propertySchema)]));
  }
  if (schema.type === 'array') return [];
  if (schema.type === 'boolean') return schema.default === true;
  return schema.default !== undefined ? String(schema.default) : '';
}

// Turn a fetched typed value back into an editable raw tree (for property edits).
function valueToRaw(schema: Schema | undefined, value: unknown): RawValue {
  if (schema?.type === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(Object.entries(schema.properties || {}).map(([key, propertySchema]) => [key, valueToRaw(propertySchema, (value as Record<string, unknown>)[key])]));
  }
  if (schema?.type === 'array' && Array.isArray(value)) return value.map(item => valueToRaw(schema.items, item));
  if (typeof value === 'boolean') return value;
  return value === undefined || value === null ? '' : String(value);
}

// Turn the edited raw tree into the typed JSON payload, pruning empty optionals.
function coerceTree(schema: Schema | undefined, raw: RawValue): unknown {
  const type = schema?.type;
  if (type === 'object') {
    const required = new Set(schema?.required || []);
    const source = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw as Record<string, RawValue> : {};
    const out: Record<string, unknown> = {};
    for (const [key, propertySchema] of Object.entries(schema?.properties || {})) {
      const coerced = coerceTree(propertySchema, source[key] ?? defaultRaw(propertySchema));
      if ((coerced === undefined || coerced === '') && !required.has(key)) continue;
      out[key] = coerced;
    }
    return out;
  }
  if (type === 'array') {
    const items = Array.isArray(raw) ? raw : [];
    return items.map(item => coerceTree(schema?.items, item)).filter(value => value !== undefined && value !== '');
  }
  if (type === 'boolean') return Boolean(raw);
  if (type === 'number' || type === 'integer') return raw === '' ? undefined : Number(raw);
  return raw;
}

// A single leaf control (boolean/enum/number/text) chosen from the schema.
function LeafInput({ schema, raw, onChange, label }: { schema: Schema; raw: RawValue; onChange: (next: RawValue) => void; label?: string }) {
  const numeric = schema.type === 'number' || schema.type === 'integer';
  const placeholder = numeric && schema.minimum !== undefined && schema.maximum !== undefined ? `${schema.minimum}–${schema.maximum}` : undefined;
  if (schema.type === 'boolean') {
    return <Checkbox aria-label={label} checked={raw === true} onChange={event => onChange(event.target.checked)} />;
  }
  if (schema.enum) {
    return <Select aria-label={label} value={String(raw)} onChange={event => onChange(event.target.value)}>
      {schema.enum.map(option => <Select.Option key={String(option)} value={String(option)}>{String(option)}</Select.Option>)}
    </Select>;
  }
  return <TextInput className="inline-input" aria-label={label} type={numeric ? 'number' : 'text'} value={String(raw ?? '')}
    min={schema.minimum} max={schema.maximum} placeholder={placeholder}
    onChange={event => onChange(event.target.value)} />;
}

// Recursive input editor: an object renders a field per property (with its TD
// description), an array renders add/removable item editors, a leaf a control.
// Header shown above a nested object/array: its name, datatype and description,
// so the group that follows reads as one labelled branch of the tree.
function GroupHeader({ label, required, schema }: { label?: string; required?: boolean; schema: Schema }) {
  if (!label && !schema.description) return null;
  return <Stack gap="none" className="schema-group-header">
    {label && <Stack direction="horizontal" gap="condensed" align="center">
      <FieldLabel>{label}{required ? ' *' : ''}</FieldLabel><TypeBadge schema={schema} />
    </Stack>}
    {schema.description && <Text size="small" className="muted">{schema.description}</Text>}
  </Stack>;
}

// `name` is an accessible-name fallback for the control itself: when a scalar
// input has no visible `label` (e.g. a top-level action input or a scalar
// property edit, where the affordance name already sits in an adjacent cell),
// it still needs an aria-label so screen readers can announce it.
function SchemaInput({ schema, raw, onChange, label, required, name }: { schema: Schema; raw: RawValue; onChange: (next: RawValue) => void; label?: string; required?: boolean; name?: string }) {
  if (schema.type === 'object') {
    const requiredSet = new Set(schema.required || []);
    const object = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw as Record<string, RawValue> : {};
    return <Stack gap="condensed" className="schema-object">
      <GroupHeader label={label} required={required} schema={schema} />
      <Stack gap="normal" className="schema-group">
        {Object.entries(schema.properties || {}).map(([key, propertySchema]) => (
          <SchemaInput key={key} schema={propertySchema} label={propertySchema.title || key} required={requiredSet.has(key)}
            raw={object[key] ?? defaultRaw(propertySchema)}
            onChange={next => onChange({ ...object, [key]: next })} />
        ))}
      </Stack>
    </Stack>;
  }
  if (schema.type === 'array') {
    const items = Array.isArray(raw) ? raw : [];
    const itemSchema = schema.items || {};
    return <Stack gap="condensed" className="schema-object">
      <GroupHeader label={label} required={required} schema={schema} />
      <Stack gap="condensed" className="schema-group">
        {items.map((item, index) => <Stack key={index} direction="horizontal" gap="condensed" align="start">
          <div className="array-item"><SchemaInput schema={itemSchema} label={`${index + 1}`} raw={item}
            onChange={next => onChange(items.map((existing, other) => other === index ? next : existing))} /></div>
          <IconButton icon={TrashIcon} aria-label={`Remove item ${index + 1}`} variant="invisible" size="small"
            onClick={() => onChange(items.filter((_, other) => other !== index))} />
        </Stack>)}
        <Button size="small" leadingVisual={PlusIcon} onClick={() => onChange([...items, defaultRaw(itemSchema)])}>Add item</Button>
      </Stack>
    </Stack>;
  }
  return <Stack direction="horizontal" justify="space-between" align="center" gap="normal" wrap="wrap" className="schema-leaf">
    {(label || schema.description) && <Stack gap="none" className="schema-leaf-label">
      {label && <Stack direction="horizontal" gap="condensed" align="center"><FieldLabel>{label}{required ? ' *' : ''}</FieldLabel><TypeBadge schema={schema} /></Stack>}
      {schema.description && <Text size="small" className="muted">{schema.description}</Text>}
    </Stack>}
    <LeafInput schema={schema} raw={raw} onChange={onChange} label={label ?? name} />
  </Stack>;
}

// Recursive read-only display of a typed value, using the schema for labels and
// its descriptions (as tooltips). Objects/arrays render structured, not as JSON.
function SchemaValue({ schema, value }: { schema?: Schema; value: unknown }) {
  if (Array.isArray(value)) {
    if (!value.length) return <Text className="mono muted">[ ]</Text>;
    return <Stack gap="none" className="value-nest">
      {value.map((item, index) => <Stack key={index} direction="horizontal" gap="condensed" align="baseline">
        <Text className="mono muted">{index}</Text><SchemaValue schema={schema?.items} value={item} />
      </Stack>)}
    </Stack>;
  }
  if (value && typeof value === 'object') {
    return <Stack gap="none" className="value-nest">
      {Object.entries(value as Record<string, unknown>).map(([key, item]) => <Stack key={key} direction="horizontal" gap="condensed" align="baseline">
        <Text className="mono" weight="semibold" title={schema?.properties?.[key]?.description}>{key}</Text>
        <SchemaValue schema={schema?.properties?.[key]} value={item} />
      </Stack>)}
    </Stack>;
  }
  return <ValueCode value={value} />;
}

// A schema rendered as the tree of members the TD *declares* — type, unit,
// semantic annotations, constraints and descriptions at every level. SchemaValue
// shows what a nested object currently contains; this shows what it may contain,
// which is where nested titles, units and descriptions live (they previously
// survived only as a title= tooltip, if at all).
// `showDescription` is off at the root of a *property's* tree: there the root
// node is the property itself, whose description the row already carries, so
// repeating it here would just echo the line directly above. Nested members and
// action/event schemas keep theirs — those descriptions appear nowhere else.
function SchemaTree({ schema, name, required, showDescription = true }: { schema?: Schema; name?: string; required?: boolean; showDescription?: boolean }) {
  if (!schema) return null;
  const constraints = constraintList(schema);
  const children = schema.type === 'object' ? Object.entries(schema.properties || {}) : [];
  const requiredSet = new Set(schema.required || []);
  return <Stack gap="none" className="schema-tree-node">
    <Stack direction="horizontal" gap="condensed" align="center" wrap="wrap">
      {name && <Text className="mono" weight="semibold" size="small">{name}{required ? ' *' : ''}</Text>}
      {schema.type && <TypeName type={schema.type} />}
      {typeof schema.unit === 'string' && <Stack direction="horizontal" gap="condensed" align="center">
        <FieldLabel>unit</FieldLabel><SemanticTerm term={schema.unit} />
      </Stack>}
      {constraints.map(constraint => <Text key={constraint} size="small" className="muted constraint">{constraint}</Text>)}
    </Stack>
    {showDescription && schema.description && <Text size="small" className="muted">{schema.description}</Text>}
    {schema.enum && <ChipRow items={schema.enum.map(value => <InlineCode key={String(value)}>{formatValue(value)}</InlineCode>)} />}
    {(children.length > 0 || schema.items) && <div className="schema-tree-children">
      {children.map(([key, child]) => <SchemaTree key={key} schema={child} name={key} required={requiredSet.has(key)} />)}
      {schema.items && <SchemaTree schema={schema.items} name="items" />}
    </div>}
  </Stack>;
}

// --- Properties: live state rows ---------------------------------------

type ValueState = { status: 'loading' | 'ready' | 'error'; value?: unknown; error?: string; updatedAt?: number };
type EventLogEntry = { at: number; data: string; json: boolean };

function PropertyDetail({ property }: { property: Property }) {
  const flags = [
    { label: 'writable', on: property.writable, hint: 'Declares a writeproperty operation' },
    { label: 'readable', on: property.node.writeOnly !== true, hint: 'Declares a readproperty operation' },
    { label: 'observable', on: property.observable, hint: 'Pushes updates instead of needing a re-read' }
  ];
  return <DetailPanel>
    <DetailSection title="Access"><FlagList flags={flags} /></DetailSection>
    <DetailSection title="Schema"><SchemaTree schema={property.schema} showDescription={false} /></DetailSection>
    <TypeAnnotations node={property.node} />
    <DetailSection title="Forms"><FormsTable forms={property.schema.forms} /></DetailSection>
    <ExtraTerms node={property.node} rendered={renderedTerms.property} />
  </DetailPanel>;
}

function PropertyRow({ property, state, onWrite }: { property: Property; state: ValueState; onWrite: (value: unknown) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<RawValue>('');
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const structured = property.type === 'object' || property.type === 'array';
  const constraints = constraintList(property.schema);

  function startEditing() {
    setDraft(valueToRaw(property.schema, state.value));
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    try { await onWrite(coerceTree(property.schema, draft)); setEditing(false); }
    finally { setSaving(false); }
  }

  return <>
    <tr className={expanded ? 'has-subrow' : undefined}>
      <td><Stack direction="horizontal" gap="condensed" align="start">
        <ExpandButton expanded={expanded} onToggle={() => setExpanded(value => !value)} label={property.name} />
        <AffordanceName name={property.name} title={property.title} description={property.description} />
      </Stack></td>
      <td>
        {editing ? <Stack gap="condensed" align="start">
          <SchemaInput schema={property.schema} raw={draft} onChange={setDraft} label={structured ? property.name : undefined} name={property.name} />
          <Stack direction="horizontal" gap="condensed">
            <Button size="small" variant="primary" loading={saving} onClick={() => void save()}>Set</Button>
            <Button size="small" variant="invisible" onClick={() => setEditing(false)}>Cancel</Button>
          </Stack>
        </Stack> : <Stack gap="none">
          <Stack direction="horizontal" gap="condensed" align="center" wrap="wrap">
            {state.status === 'loading'
              ? <Spinner size="small" />
              : state.status === 'error'
                ? <Text className="mono value-error">{state.error}</Text>
                : structured
                  ? <div key={state.updatedAt} className={property.observable ? 'prop-value-flash' : undefined}><SchemaValue schema={property.schema} value={state.value} /></div>
                  : <ValueCode key={state.updatedAt} value={state.value} className={property.observable ? 'prop-value-flash' : undefined} />}
            {property.writable && state.status !== 'loading' && <Button size="small" variant="invisible" onClick={startEditing}>Edit</Button>}
          </Stack>
          {property.observable && state.status === 'ready' && <Stack direction="horizontal" gap="condensed" align="center">
            <span className="live-dot" aria-hidden="true" title="Observable — this value updates live, no manual read needed" />
            <Text size="small" className="muted">live · updated {state.updatedAt ? <RelativeTime date={new Date(state.updatedAt)} /> : 'now'}</Text>
          </Stack>}
        </Stack>}
      </td>
      <td>
        <Stack gap="none">
          <Stack direction="horizontal" gap="condensed" align="center" wrap="wrap">
            <TypeBadge schema={property.schema} />
            <Text as="span" size="small" className="muted" title={property.writable ? 'Writable — you can set a new value' : 'Read-only — this property cannot be written from here'}>
              {property.writable ? 'writable' : 'read-only'}
            </Text>
          </Stack>
          {/* Constraints belong next to the value, not only inside an input's
              placeholder — they describe the property whether or not it's being
              edited. Enum members are listed rather than reduced to "enum". */}
          {constraints.length > 0 && <Text size="small" className="muted">{constraints.join(' · ')}</Text>}
          {property.schema.enum && <Text size="small" className="muted">{property.schema.enum.map(formatValue).join(' | ')}</Text>}
        </Stack>
      </td>
    </tr>
    {expanded && <tr className="subrow"><td colSpan={3}><PropertyDetail property={property} /></td></tr>}
  </>;
}

// --- Actions: invocation rows (main row + optional result subrow) -------

type ActionResult = { status: number; text: string; value?: unknown; hasValue: boolean } | null;

function ActionDetail({ action, invocation }: { action: Action; invocation: Resolved }) {
  const flags = [
    { label: 'safe', on: action.node.safe === true, hint: 'Invoking it does not change the Thing’s state' },
    { label: 'idempotent', on: action.node.idempotent === true, hint: 'Invoking it repeatedly has the same effect as once' },
    ...(action.node.synchronous === undefined ? [] : [{ label: 'synchronous', on: action.node.synchronous === true, hint: 'The response carries the result' }])
  ];
  const effects = action.node['vre:effects'];
  return <DetailPanel>
    {/* An action's declared behavior leads the panel: for a VRE-driven Thing this
        *is* the action, the whole implementation, with no logic.js behind it. */}
    {typeof effects === 'string' && <DetailSection title="Effects">
      <Text size="small" className="muted">
        Declared in the Thing Description as <InlineCode>vre:effects</InlineCode>. Each primed assignment
        (<InlineCode>{'prop′ = …'}</InlineCode>) writes the property and emits a property change, so the
        effect is observable rather than only readable.
      </Text>
      <pre className="term-code"><code>{effects}</code></pre>
    </DetailSection>}
    <DetailSection title="Invocation semantics">
      <FlagList flags={flags} />
      <Text size="small" className="muted">
        {action.node.safe ? 'Declared safe: invoking it does not change the Thing’s state.' : 'Not declared safe: invoking it may change the Thing’s state.'}
        {action.node.idempotent ? ' Invoking it repeatedly has the same effect as invoking it once.' : ''}
      </Text>
    </DetailSection>
    {action.input && <DetailSection title="Input schema"><SchemaTree schema={action.input} /></DetailSection>}
    {action.output && <DetailSection title="Output schema"><SchemaTree schema={action.output} /></DetailSection>}
    <TypeAnnotations node={action.node} />
    <DetailSection title="Forms">
      <FormsTable forms={action.node.forms} />
      {!invocation.declared && <Text size="small" className="muted">
        No <InlineCode>invokeaction</InlineCode> form declared — Invoke falls back to the conventional wot-lab path.
      </Text>}
    </DetailSection>
    <ExtraTerms node={action.node} rendered={renderedTerms.action} />
  </DetailPanel>;
}

function ActionRows({ thingId, action }: { thingId: string; action: Action }) {
  const [raw, setRaw] = useState<RawValue>(() => defaultRaw(action.input));
  const [result, setResult] = useState<ActionResult>(null);
  const [pending, setPending] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Method, path and media type come from the TD's own invokeaction form rather
  // than from a path template this client invents.
  const invocation = resolveOp(action.node.forms, 'invokeaction',
    `/${encodeURIComponent(thingId)}/actions/${encodeURIComponent(action.name)}`, 'POST');

  async function invoke() {
    setPending(true);
    setResult(null);
    try {
      const body = action.input ? coerceTree(action.input, raw) : undefined;
      const response = await fetch(invocation.url, {
        method: invocation.method,
        headers: body === undefined ? {} : { 'Content-Type': invocation.contentType },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      const text = await response.text();
      let value: unknown;
      let hasValue = false;
      let formatted = text;
      try { value = JSON.parse(text); hasValue = text.trim() !== ''; formatted = JSON.stringify(value, null, 2); } catch { /* plain text */ }
      setResult({ status: response.status, text: formatted || 'Completed.', value, hasValue });
    } catch (cause) {
      setResult({ status: 0, text: cause instanceof Error ? cause.message : 'Request failed.', hasValue: false });
    } finally {
      setPending(false);
    }
  }

  const ok = result ? result.status >= 200 && result.status < 300 : false;
  const structuredValue = result?.hasValue && result.value !== null && typeof result.value === 'object';
  const showBody = result !== null && !(ok && !structuredValue && (result.text === 'Completed.' || result.text === 'null' || result.text === ''));

  return <>
    <tr className={showBody || expanded ? 'has-subrow' : undefined}>
      <td><Stack direction="horizontal" gap="condensed" align="start">
        <ExpandButton expanded={expanded} onToggle={() => setExpanded(value => !value)} label={action.name} />
        <AffordanceName name={action.name} title={action.title} description={action.description} />
      </Stack></td>
      <td>{action.input
        ? <Stack gap="condensed" align="start" className="action-input">
            <TypeBadge schema={action.input} />
            <SchemaInput schema={action.input} raw={raw} onChange={setRaw} name={action.name} />
          </Stack>
        : <Text className="muted">—</Text>}</td>
      <td><TypeBadge schema={action.output} /></td>
      <td className="cell-shrink">
        <Stack direction="horizontal" gap="condensed" align="center" wrap="wrap">
          <Button variant="primary" loading={pending} leadingVisual={PlayIcon} onClick={() => void invoke()}>Invoke</Button>
          {result && <Label variant={result.status === 0 || !ok ? 'danger' : 'success'}>{result.status === 0 ? 'Error' : ok ? 'OK' : result.status}</Label>}
        </Stack>
      </td>
    </tr>
    {/* One subrow carries both the detail panel and the invocation result, so an
        expanded row with a result still reads as a single bordered group. */}
    {(showBody || expanded) && <tr className="subrow"><td colSpan={4}>
      <Stack gap="normal">
        {expanded && <ActionDetail action={action} invocation={invocation} />}
        {showBody && (structuredValue
          ? <div className="result"><SchemaValue schema={action.output} value={result?.value} /></div>
          : result?.hasValue
            ? <JsonBlock className="result" source={result.text} />
            : <Text as="pre" className="result">{result?.text}</Text>)}
      </Stack>
    </td></tr>}
  </>;
}

// --- Events: subscription rows (main row + streaming log subrow) --------

function EventDetail({ event, subscription }: { event: EventAffordance; subscription: Resolved }) {
  return <DetailPanel>
    <DetailSection title="Delivery">
      <Stack direction="horizontal" gap="condensed" align="center" wrap="wrap">
        <Text className="mono op-name" size="small">{subscription.subprotocol ?? 'http'}</Text>
        <Text className="mono muted" size="small">{subscription.contentType}</Text>
      </Stack>
      {subscription.subprotocol === 'longpoll' && <Text size="small" className="muted">
        Delivered by long polling: each request stays open until the Thing emits, then the client re-subscribes.
      </Text>}
    </DetailSection>
    {event.data && <DetailSection title="Data schema"><SchemaTree schema={event.data} /></DetailSection>}
    {event.node.subscription && <DetailSection title="Subscription schema"><SchemaTree schema={event.node.subscription} /></DetailSection>}
    {event.node.cancellation && <DetailSection title="Cancellation schema"><SchemaTree schema={event.node.cancellation} /></DetailSection>}
    {event.node.dataResponse && <DetailSection title="Data response schema"><SchemaTree schema={event.node.dataResponse} /></DetailSection>}
    <TypeAnnotations node={event.node} />
    <DetailSection title="Forms"><FormsTable forms={event.node.forms} /></DetailSection>
    <ExtraTerms node={event.node} rendered={renderedTerms.event} />
  </DetailPanel>;
}

// The row is presentational: its subscription state and streaming log live in
// ThingInspector, above the tab switch, so neither is lost when the Events table
// unmounts (see `streamEvent` there).
function EventRows({ event, subscription, subscribed, log, onSubscribedChange }: {
  event: EventAffordance;
  subscription: Resolved;
  subscribed: boolean;
  log: EventLogEntry[];
  onSubscribedChange: (next: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return <>
    <tr className="has-subrow">
      <td><Stack direction="horizontal" gap="condensed" align="start">
        <ExpandButton expanded={expanded} onToggle={() => setExpanded(value => !value)} label={event.name} />
        <AffordanceName name={event.name} title={event.title} description={event.description} id={`event-${event.name}`} />
      </Stack></td>
      <td><TypeBadge schema={event.data} /></td>
      <td className="cell-shrink">
        <Stack direction="horizontal" align="center">
          <ToggleSwitch size="small" checked={subscribed} onChange={onSubscribedChange} aria-labelledby={`event-${event.name}`} />
        </Stack>
      </td>
    </tr>
    <tr className="subrow"><td colSpan={3}>
      <Stack gap="normal">
        {expanded && <EventDetail event={event} subscription={subscription} />}
        <pre className="event-log">{log.length
          ? log.map((entry, index) => <span className="event-log-row" key={index}>
              <span className="event-log-time">{new Date(entry.at).toLocaleTimeString()}</span>
              {entry.json ? <HighlightedJson source={entry.data} /> : entry.data}
            </span>)
          : <span className="event-log-empty">{subscribed ? 'Waiting for events…' : 'Subscribe to stream events.'}</span>}</pre>
      </Stack>
    </td></tr>
  </>;
}

// --- Thing Description source ------------------------------------------

// The whole document, verbatim. The affordance tabs are an interpretation of the
// TD; this is the TD — the ground truth to check that interpretation against,
// and the only view guaranteed complete no matter what terms a Thing carries.
function ThingDescriptionSource({ thing }: { thing: InspectedThing }) {
  const [copied, setCopied] = useState(false);
  const source = JSON.stringify(thing.td, null, 2);
  const lineCount = source.split('\n').length;

  async function copy() {
    try {
      await navigator.clipboard.writeText(source);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable (insecure origin) — the text is selectable */ }
  }

  return <Stack gap="normal">
    <Stack direction="horizontal" align="center" justify="space-between" gap="normal" wrap="wrap">
      <Text size="small" className="muted">
        The complete Thing Description as served, including every term the tabs above interpret.
      </Text>
      <Stack direction="horizontal" align="center" gap="condensed">
        <Button size="small" leadingVisual={copied ? CheckIcon : CopyIcon} onClick={() => void copy()}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button size="small" leadingVisual={LinkExternalIcon} onClick={() => void openThingDescription(thing.id)}>Raw</Button>
      </Stack>
    </Stack>
    <div className="code-example">
      <div className="code-example-head">
        <Stack direction="horizontal" align="center" justify="space-between" gap="normal">
          <Text className="mono" size="small" weight="semibold">{thing.id}.td.json</Text>
          <Text size="small" className="muted">{lineCount} lines · application/td+json</Text>
        </Stack>
      </div>
      {/* Line numbers come from a CSS counter on each row rather than a gutter
          column, so selecting the code copies the JSON without them. */}
      <pre className="code-example-body td-source">
        {source.split('\n').map((line, index) => (
          <span className="td-line" key={index}><HighlightedJson source={line} />{'\n'}</span>
        ))}
      </pre>
    </div>
  </Stack>;
}

// The Thing's identifying facts, as a labelled strip under its title.
//
// These lived in the app bar, which had three costs: the chrome reshaped itself
// on every navigation, the title and id were printed twice under inconsistent
// rules (the bar always showed the id, the body hid it when it echoed the
// title), and `@type` rendered as flat text when it is a semantic annotation
// that @context can resolve. Here they sit with the Thing, wrap freely, and the
// strip has room to carry the document-level facts — security, base — that
// otherwise appear only in the raw source.
function ThingMeta({ thing }: { thing: InspectedThing }) {
  const { td } = thing;
  const applied = Array.isArray(td.security) ? td.security : td.security ? [td.security] : [];
  // An applied name points at a definition; the scheme it names is the fact
  // worth showing ("nosec"), not the key someone happened to file it under.
  const schemes = [...new Set(applied.map(name => td.securityDefinitions?.[name]?.scheme ?? name))];
  const types = (thing.atType ?? '').split(', ').filter(Boolean);

  const items: [string, React.ReactNode][] = [['id', <Text className="mono">{thing.id}</Text>]];
  if (types.length) items.push(['@type', <ChipRow items={types.map(type => <SemanticTerm key={type} term={type} />)} />]);
  if (schemes.length) items.push(['security', <Text className="mono" title={schemes.includes('nosec') ? 'nosec — no security applied; every affordance is open to any caller' : undefined}>{schemes.join(', ')}</Text>]);
  if (typeof td.base === 'string') items.push(['base', <Text className="mono">{td.base}</Text>]);

  return <Stack direction="horizontal" gap="normal" wrap="wrap" className="thing-meta">
    {items.map(([label, value]) => <Stack key={label} direction="horizontal" gap="condensed" align="center">
      <FieldLabel>{label}</FieldLabel>{value}
    </Stack>)}
  </Stack>;
}

// --- Thing inspector ----------------------------------------------------

// A native <table> rather than Primer's DataTable (@primer/react/experimental):
// DataTable is still experimental and models flat, cell-per-column rows, whereas
// these affordance tables need recursive schema-driven form cells, expandable
// result/log subrows and live-flash values — patterns it doesn't support. The
// markup below is plain <table> tokened with Primer Primitives in styles.css.
function AffordanceTable({ caption, headers, modifier, children }: { caption: string; headers: string[]; modifier?: 'grow' | 'actions'; children: React.ReactNode }) {
  return <div className="table-scroll">
    <table className={`aff-table${modifier ? ` aff-table--${modifier}` : ''}`}>
      <caption className="aff-caption">{caption}</caption>
      <thead><tr>{headers.map(header => <th key={header}>{header}</th>)}</tr></thead>
      <tbody>{children}</tbody>
    </table>
  </div>;
}

function ThingInspector({ thing, section, onSection, onRemove }: { thing: InspectedThing; section: Section | null; onSection: (section: Section, options?: { replace?: boolean }) => void; onRemove: () => void }) {
  const [values, setValues] = useState<Record<string, ValueState>>({});
  const [subscribed, setSubscribed] = useState<Record<string, boolean>>({});
  const [logs, setLogs] = useState<Record<string, EventLogEntry[]>>({});
  const streamsRef = useRef(new Map<string, AbortController>());

  // Affordance tabs appear only when the Thing has that kind; the source tab
  // always does, since every Thing has a Thing Description.
  const kinds: [Section, number | undefined][] = [
    ...([['properties', thing.properties.length], ['actions', thing.actions.length], ['events', thing.events.length]] as [Section, number][])
      .filter(([, count]) => count > 0),
    ['td', undefined]
  ];
  const active: Section | undefined = (section && kinds.some(([kind]) => kind === section)) ? section : kinds[0]?.[0];

  // The Thing URL (/counter) or an unknown kind resolves to the first sub-page;
  // keep the address bar in step (replace, so Back still returns to the list).
  useEffect(() => {
    if (active && active !== section) onSection(active, { replace: true });
  }, [active, section, onSection]);

  const setValue = (name: string, patch: Partial<ValueState>) =>
    setValues(current => ({ ...current, [name]: { ...current[name], ...patch } }));

  useEffect(() => {
    setValues(Object.fromEntries(thing.properties.map(p => [p.name, { status: 'loading' } as ValueState])));
    const controller = new AbortController();

    // Endpoints come from each property's own forms — `readproperty` and
    // `observeproperty` — instead of a path template this client guesses. The
    // conventional wot-lab paths remain as the fallback for a TD without forms.
    const base = `/${encodeURIComponent(thing.id)}/properties/`;

    const readOnce = async (property: Property) => {
      try {
        const target = resolveOp(property.schema.forms, 'readproperty', `${base}${encodeURIComponent(property.name)}`, 'GET');
        const value = await requestJson<unknown>(target.url, controller.signal);
        setValue(property.name, { status: 'ready', value, updatedAt: Date.now() });
      } catch (cause) {
        if (controller.signal.aborted) return;
        setValue(property.name, { status: 'error', error: cause instanceof Error ? cause.message : 'unreadable' });
      }
    };

    const observe = async (property: Property) => {
      const target = resolveOp(property.schema.forms, 'observeproperty', `${base}${encodeURIComponent(property.name)}/observable`, 'GET');
      while (!controller.signal.aborted) {
        try {
          const value = await requestJson<unknown>(target.url, controller.signal);
          setValue(property.name, { status: 'ready', value, updatedAt: Date.now() });
        } catch (cause) {
          if (controller.signal.aborted) return;
          try { await delay(1000, controller.signal); } catch { return; }
        }
      }
    };

    for (const property of thing.properties) {
      void readOnce(property).then(() => { if (property.observable) void observe(property); });
    }
    return () => controller.abort();
  }, [thing]);

  // --- Event streams -----------------------------------------------------
  // These live here, above the tab switch, rather than inside EventRows: the
  // Events table unmounts the moment you look at Properties, which would abort
  // every open long poll and drop its log. Held here, a subscription keeps
  // streaming and keeps accumulating while you're on another tab. Switching
  // Things still resets them — <ThingInspector> is keyed by Thing id.
  const eventSubscription = useCallback((event: EventAffordance) => resolveOp(event.node.forms, 'subscribeevent',
    `/${encodeURIComponent(thing.id)}/events/${encodeURIComponent(event.name)}`, 'GET'), [thing.id]);

  useEffect(() => {
    const streams = streamsRef.current;
    const stream = async (event: EventAffordance, signal: AbortSignal) => {
      const target = eventSubscription(event);
      while (!signal.aborted) {
        try {
          const response = await fetch(target.url, { headers: { Accept: 'application/json' }, signal });
          const text = await response.text();
          let data = text;
          let json = false;
          try { data = JSON.stringify(JSON.parse(text)); json = true; } catch { /* plain text */ }
          setLogs(current => ({ ...current, [event.name]: [{ at: Date.now(), data: data || '(no payload)', json }, ...(current[event.name] || [])].slice(0, 50) }));
        } catch {
          if (signal.aborted) return;
          try { await delay(1000, signal); } catch { return; }
        }
      }
    };

    // Reconcile rather than restart: an already-running stream is left alone, so
    // subscribing to a second event doesn't interrupt the first one's long poll.
    for (const event of thing.events) {
      if (subscribed[event.name] && !streams.has(event.name)) {
        const controller = new AbortController();
        streams.set(event.name, controller);
        void stream(event, controller.signal);
      }
    }
    for (const [name, controller] of [...streams]) {
      if (!subscribed[name]) { controller.abort(); streams.delete(name); }
    }
  }, [subscribed, thing, eventSubscription]);

  // Close every open stream when the inspector itself goes away.
  useEffect(() => {
    const streams = streamsRef.current;
    return () => { for (const controller of streams.values()) controller.abort(); streams.clear(); };
  }, []);

  async function writeProperty(property: Property, value: unknown) {
    const path = `/${encodeURIComponent(thing.id)}/properties/${encodeURIComponent(property.name)}`;
    const target = resolveOp(property.schema.forms, 'writeproperty', path, 'PUT');
    await fetch(target.url, { method: target.method, headers: { 'Content-Type': target.contentType }, body: JSON.stringify(value) });
    if (!property.observable) {
      try {
        const fresh = await requestJson<unknown>(resolveOp(property.schema.forms, 'readproperty', path, 'GET').url);
        setValue(property.name, { status: 'ready', value: fresh, updatedAt: Date.now() });
      } catch { /* leave prior value */ }
    }
  }

  return <TdContext.Provider value={thing.context}><Stack gap="spacious">
    <Stack gap="condensed">
      <Stack direction="horizontal" align="center" justify="space-between" gap="normal" wrap="wrap">
        <Heading as="h2">{thing.title}</Heading>
        <IconButton icon={TrashIcon} variant="invisible" aria-label={`Remove ${thing.title}`} onClick={onRemove} />
      </Stack>
      <ThingMeta thing={thing} />
      {thing.description && <Text className="muted">{thing.description}</Text>}
    </Stack>

    <Stack gap="normal">
      {/* No eyebrow here: one of the tabs is now itself labelled "Thing
          Description", and a heading repeating it would read as a clash. */}
      <UnderlineNav aria-label="Thing sections">
        {kinds.map(([kind, count]) => (
          <UnderlineNav.Item key={kind} href={`/${encodeURIComponent(thing.id)}/${kind}`} counter={count}
            aria-current={kind === active ? 'page' : undefined}
            onSelect={event => { event.preventDefault(); onSection(kind); }}>
            {sectionLabel[kind]}
          </UnderlineNav.Item>
        ))}
      </UnderlineNav>

      {active === 'properties' && <AffordanceTable
        caption="Readable state. Values marked live (●) update on their own; read-only properties can't be written from here. Expand a row for its schema, constraints and protocol forms."
        headers={['Property', 'Value', 'Type']}>
        {thing.properties.map(property => (
          <PropertyRow key={property.name} property={property}
            state={values[property.name] ?? { status: 'loading' }}
            onWrite={value => writeProperty(property, value)} />
        ))}
      </AffordanceTable>}

      {active === 'actions' && <AffordanceTable modifier="actions"
        caption="Operations you invoke. Provide any input, then Invoke; the returned output (if any) appears below the row. Expand a row for its safe/idempotent semantics and protocol forms."
        headers={['Action', 'Input', 'Output', 'Invoke']}>
        {thing.actions.map(action => <ActionRows key={action.name} thingId={thing.id} action={action} />)}
      </AffordanceTable>}

      {active === 'events' && <AffordanceTable modifier="grow"
        caption="Notifications the Thing pushes. Toggle Subscribe to open a live stream; emitted events appear in the log below. Expand a row for its data schema and delivery protocol."
        headers={['Event', 'Data', 'Subscribe']}>
        {thing.events.map(event => <EventRows key={event.name} event={event}
          subscription={eventSubscription(event)}
          subscribed={subscribed[event.name] === true}
          log={logs[event.name] ?? []}
          onSubscribedChange={next => setSubscribed(current => ({ ...current, [event.name]: next }))} />)}
      </AffordanceTable>}

      {active === 'td' && <ThingDescriptionSource thing={thing} />}
    </Stack>
  </Stack></TdContext.Provider>;
}

// --- Landing page -------------------------------------------------------

function Landing({ things, models, loading, onOpen, onAdd }: {
  things: ThingEntry[]; models: ThingModel[]; loading: boolean; onOpen: (id: string) => void; onAdd: () => void;
}) {
  return <Stack gap="spacious">
    <Stack gap="condensed">
      <Text className="eyebrow eyebrow-accent" as="div">Overview</Text>
      <Heading as="h2"><Stack direction="horizontal" align="center" gap="condensed"><BeakerIcon size={28} />WoT Lab</Stack></Heading>
      <Text className="muted">
        A framework for prototyping virtual W3C Web of Things devices. Each Thing is exposed over the
        WoT HTTP protocol. Click on a Thing below, to inspect and interact with its properties, actions and events.
      </Text>
    </Stack>

    <Stack gap="normal">
      <Stack direction="horizontal" align="center" gap="condensed">
        <Heading as="h3" style={{ fontSize: 18 }}>Exposed Things</Heading>
        {!loading && <CounterLabel>{things.length}</CounterLabel>}
      </Stack>
      {loading
        ? <Stack align="center" padding="normal"><Spinner /></Stack>
        : things.length
          ? <div className="thing-grid">
              {things.map(entry => (
                <button key={entry.id} type="button" className="thing-card" onClick={() => onOpen(entry.id)}>
                  <Text weight="semibold">{entry.title}</Text>
                  {/* Only show the id when it adds something the title doesn't — for a
                      single-instance Thing the id is just the lowercased title, so it
                      would only be noise (same convention as AffordanceName). */}
                  {!idEchoesTitle(entry.id, entry.title) && <Text className="mono field-label">{entry.id}</Text>}
                  {entry.description && <Text size="small" className="muted thing-card-desc">{entry.description}</Text>}
                </button>
              ))}
            </div>
          /* Nothing runs unless it was asked for, so an empty lab is the normal
             starting state rather than a fault — it says what is available and
             offers the one action that changes it. */
          : <div className="empty-state">
              <Stack gap="condensed" align="start">
                <Text weight="semibold">Nothing is running yet.</Text>
                <Text className="muted">
                  {models.length
                    ? `${models.length} Thing ${models.length === 1 ? 'Model is' : 'Models are'} available on disk. Create a Thing from one, or write a new model.`
                    : 'No Thing Models were found on disk. Write one to get started.'}
                </Text>
                <Button variant="primary" leadingVisual={PlusIcon} onClick={onAdd}>Add a Thing</Button>
              </Stack>
            </div>}
    </Stack>
  </Stack>;
}

// --- App shell ----------------------------------------------------------

const nextColorMode: Record<ColorMode, ColorMode> = { auto: 'light', light: 'dark', dark: 'auto' };
const colorModeIcon: Record<ColorMode, typeof SunIcon> = { auto: DeviceDesktopIcon, light: SunIcon, dark: MoonIcon };

function App() {
  const { route, navigate } = useRoute();
  const [colorMode, setColorMode] = useState<ColorMode>('auto');
  const [things, setThings] = useState<ThingEntry[]>([]);
  const [models, setModels] = useState<ThingModel[]>([]);
  const [live, setLive] = useState<LabThing[]>([]);
  const [startCommand, setStartCommand] = useState('');
  const [thing, setThing] = useState<InspectedThing | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<ThingEntry | null>(null);
  const [removeFiles, setRemoveFiles] = useState(false);
  const [copied, setCopied] = useState(false);

  async function loadThings() {
    setLoading(true); setError('');
    try {
      // The exposed Things, the Thing Models on disk and the lab's own view of
      // what is running are three views of the same lab; loading them together
      // keeps the sidebar, the add dialog and the start command from disagreeing.
      const [index, catalog, running] = await Promise.all([
        requestJson<{ things: ThingEntry[] }>(`${apiBase}/`),
        labThingModels(),
        labThings()
      ]);
      setThings(index.things);
      setModels(catalog.thingModels);
      setLive(running.things);
      setStartCommand(running.startCommand);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to reach WoT Lab.'); }
    finally { setLoading(false); }
  }

  useEffect(() => { void loadThings(); }, []);
  useEffect(() => {
    if (!route.thingId) { setThing(null); return; }
    setThing(null); setError('');
    const controller = new AbortController();
    void requestJson<ThingDescription>(`${apiBase}/${encodeURIComponent(route.thingId)}`, controller.signal)
      .then(description => setThing(modelFromDescription(description, route.thingId as string)))
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Unable to load Thing.'); });
    return () => controller.abort();
  }, [route.thingId]);

  async function confirmRemoval(gesture: string) {
    const target = removing;
    setRemoving(null);
    if (!target || gesture !== 'confirm') { setRemoveFiles(false); return; }
    const model = live.find(thing => thing.id === target.id)?.model;
    const result = await removeThing(target.id, { deleteFiles: removeFiles, model });
    setRemoveFiles(false);
    if (!result.ok) { setError(result.body.error || 'Unable to remove the Thing.'); return; }
    if (route.thingId === target.id) navigate(null);
    void loadThings();
  }

  async function copyStartCommand() {
    try {
      await navigator.clipboard.writeText(startCommand);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable — the command is visible in the tooltip */ }
  }

  const ColorModeIcon = colorModeIcon[colorMode];
  const currentThing = thing && thing.id === route.thingId ? thing : null;
  const removingModel = removing ? live.find(thing => thing.id === removing.id)?.model : undefined;
  // Deleting the files is only meaningful for the last Thing built from a
  // model, and only for a model the lab wrote: one that ships with the lab
  // would come back on the next deploy.
  const removingIsLastOfModel = Boolean(removingModel) &&
    live.filter(thing => thing.model === removingModel).length === 1 &&
    models.find(model => model.name === removingModel)?.writable === true;

  return <ThemeProvider colorMode={colorMode} nightScheme="dark_dimmed">
    <BaseStyles className="app-root">
      <PageLayout containerWidth="full" padding="none" rowGap="none">
        <PageLayout.Header padding="condensed" divider="line" className="app-header">
          <Stack direction="horizontal" align="center" justify="space-between" gap="normal" wrap="wrap">
            <Stack direction="horizontal" align="center" gap="condensed">
              <button type="button" className="brand" onClick={() => navigate(null)}>
                <Stack direction="horizontal" align="center" gap="condensed">
                  <BeakerIcon size={24} />
                  <Heading as="h1" style={{ fontSize: 20 }}>WoT Lab <Text className="muted" weight="normal">Dashboard</Text></Heading>
                </Stack>
              </button>
              {/* A breadcrumb, not a heading: it says where you are, while the
                  Thing's own <h2> lives once in the content column. Two <h2>s for
                  one Thing also made a confusing heading outline under the h1. */}
              {currentThing && <>
                <Text className="muted" aria-hidden="true">/</Text>
                <Text weight="semibold">{currentThing.title}</Text>
              </>}
            </Stack>
            <Stack direction="horizontal" align="center" gap="normal" wrap="wrap">
              <IconButton icon={ColorModeIcon} aria-label={`Color mode: ${colorMode}. Switch to ${nextColorMode[colorMode]}.`} variant="invisible" onClick={() => setColorMode(mode => nextColorMode[mode])} />
              <Button leadingVisual={SyncIcon} onClick={() => void loadThings()}>Refresh</Button>
              <Button variant="primary" leadingVisual={PlusIcon} onClick={() => setAdding(true)}>Add Thing</Button>
            </Stack>
          </Stack>
        </PageLayout.Header>

        <PageLayout.Pane position="start" width="small" padding="normal" divider="line" sticky>
          <Text className="eyebrow" as="div">Exposed Things</Text>
          {loading
            ? <Stack align="center" padding="normal"><Spinner size="medium" /></Stack>
            : things.length
              ? <NavList>
                  {things.map(entry => (
                    <NavList.Item key={entry.id} href={`/${encodeURIComponent(entry.id)}`} aria-current={entry.id === route.thingId}
                      onClick={event => { event.preventDefault(); navigate(entry.id); }}>
                      {entry.title}
                    </NavList.Item>
                  ))}
                </NavList>
              : <Text className="muted">No Things exposed.</Text>}

          {/* Instances live only as long as the process. Rather than persist
              them behind your back, the lab hands back the command that
              recreates exactly this set — the flags and this UI are the same
              operation, so the round trip is exact. */}
          {things.length > 0 && startCommand && <Stack gap="condensed" className="start-command">
            <Text className="eyebrow" as="div">This session</Text>
            <Text size="small" className="muted">Things run until the lab restarts. Reproduce this set with:</Text>
            <code className="start-command-code">{startCommand}</code>
            <Button size="small" leadingVisual={copied ? CheckIcon : CopyIcon} onClick={() => void copyStartCommand()}>
              {copied ? 'Copied' : 'Copy start command'}
            </Button>
          </Stack>}
        </PageLayout.Pane>

        <PageLayout.Content padding="normal">
          <div style={{ maxWidth: 960, marginInline: 'auto' }}>
            {error && <Flash variant="danger">{error}</Flash>}
            {route.thingId
              ? thing && thing.id === route.thingId
                ? <ThingInspector key={thing.id} thing={thing} section={route.section}
                    onSection={(s, options) => navigate(thing.id, s, options)}
                    onRemove={() => setRemoving(things.find(entry => entry.id === thing.id) ?? { id: thing.id, title: thing.title, href: '' })} />
                : !error && <Stack align="center" padding="spacious"><Spinner /></Stack>
              : <Landing things={things} models={models} loading={loading} onOpen={id => navigate(id)} onAdd={() => setAdding(true)} />}
          </div>
        </PageLayout.Content>
      </PageLayout>

      {adding && <CreateThingDialog models={models}
        onClose={() => setAdding(false)}
        onCreated={id => { setAdding(false); void loadThings(); if (id) navigate(id); }} />}

      {removing && <ConfirmationDialog title={`Remove ${removing.title}?`} confirmButtonType="danger"
        confirmButtonContent="Remove" onClose={gesture => void confirmRemoval(gesture)}>
        <Stack gap="condensed">
          <Text>
            Takes <Text as="span" className="mono">{removing.id}</Text> offline. Its Thing Model stays on
            disk, so a new Thing can be created from it at any time.
          </Text>
          {removingIsLastOfModel && <Stack direction="horizontal" gap="condensed" align="center">
            <Checkbox checked={removeFiles} aria-label="Also delete the files"
              onChange={event => setRemoveFiles(event.target.checked)} />
            <Text size="small">
              Also delete the Thing Model <Text as="span" className="mono">src/things/{removingModel}/</Text> — this cannot be undone.
            </Text>
          </Stack>}
        </Stack>
      </ConfirmationDialog>}
    </BaseStyles>
  </ThemeProvider>;
}

export default App;
