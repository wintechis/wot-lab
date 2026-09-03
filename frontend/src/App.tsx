import { useCallback, useEffect, useState } from 'react';
import {
  BaseStyles,
  Button,
  Checkbox,
  CounterLabel,
  Flash,
  Heading,
  IconButton,
  Label,
  type LabelColorOptions,
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
  DeviceDesktopIcon,
  FileDirectoryIcon,
  MarkGithubIcon,
  MoonIcon,
  PlayIcon,
  PlusIcon,
  SunIcon,
  SyncIcon,
  TrashIcon
} from '@primer/octicons-react';

const repositoryUrl = 'https://github.com/wintechis/wot-lab';

type ThingEntry = { id: string; title: string; href: string };
type Schema = { type?: string; title?: string; description?: string; default?: unknown; enum?: unknown[]; minimum?: number; maximum?: number; unit?: string; readOnly?: boolean; observable?: boolean; properties?: Record<string, Schema>; required?: string[]; items?: Schema };
type ThingDescription = { id?: string; title?: string; description?: string; base?: string; '@type'?: string | string[]; properties?: Record<string, Schema>; actions?: Record<string, Schema & { input?: Schema; output?: Schema }>; events?: Record<string, Schema & { data?: Schema }> };

type Property = { name: string; title?: string; description?: string; schema: Schema; type: string; writable: boolean; observable: boolean };
type Action = { name: string; title?: string; description?: string; input?: Schema; output?: Schema };
type EventAffordance = { name: string; title?: string; description?: string; data?: Schema };
type ThingModel = { id: string; title: string; description?: string; atType?: string; properties: Property[]; actions: Action[]; events: EventAffordance[] };

type ColorMode = 'auto' | 'light' | 'dark';

const apiBase = import.meta.env.DEV ? '/wot' : '';

const apiUrl = (path: string) => `${apiBase}${path}`;

// --- Client-side routing -----------------------------------------------
// Real paths, not hashes: a Thing is /counter, and each affordance kind is its
// own sub-page at /counter/actions. The server serves this SPA for any path
// whose first segment is a Thing, so these deep links load directly.
const sections = ['properties', 'actions', 'events'] as const;
type Section = (typeof sections)[number];
const sectionLabel: Record<Section, string> = { properties: 'Properties', actions: 'Actions', events: 'Events' };
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

async function requestJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { headers: { Accept: 'application/json' }, signal });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json() as Promise<T>;
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('aborted', 'AbortError')); }, { once: true });
  });
}

function modelFromDescription(description: ThingDescription, fallbackId: string): ThingModel {
  const id = (description.id || fallbackId).replace('urn:wot:', '');
  const atTypeRaw = description['@type'];
  const properties: Property[] = Object.entries(description.properties || {}).map(([name, schema]) => ({
    name,
    title: schema.title,
    description: schema.description,
    schema,
    type: schema.type || 'unknown',
    writable: !schema.readOnly,
    observable: schema.observable === true
  }));
  const actions: Action[] = Object.entries(description.actions || {}).map(([name, action]) => ({
    name, title: action.title, description: action.description, input: action.input, output: action.output
  }));
  const events: EventAffordance[] = Object.entries(description.events || {}).map(([name, event]) => ({
    name, title: event.title, description: event.description, data: event.data
  }));
  return {
    id,
    title: description.title || id,
    description: description.description,
    atType: Array.isArray(atTypeRaw) ? atTypeRaw.join(', ') : atTypeRaw,
    properties, actions, events
  };
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

// GitHub-style inline code — Primer ships no such component, so this is a
// <code> tinted with Primer Primitives tokens, for code within prose.
function InlineCode({ children }: { children: React.ReactNode }) {
  return <code className="inline-code">{children}</code>;
}

const typeColor: Record<string, LabelColorOptions> = { boolean: 'done', integer: 'accent', number: 'accent', string: 'success', object: 'attention', array: 'severe' };

// Consistent datatype rendering used by properties, action input/output and event data.
function TypeBadge({ schema }: { schema?: Schema }) {
  if (!schema || !schema.type) return <Text className="muted">—</Text>;
  const label = `${schema.type}${schema.unit ? ` · ${schema.unit}` : ''}${schema.enum ? ' · enum' : ''}`;
  return <Label variant={typeColor[schema.type] ?? 'secondary'}>{label}</Label>;
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

function SchemaInput({ schema, raw, onChange, label, required }: { schema: Schema; raw: RawValue; onChange: (next: RawValue) => void; label?: string; required?: boolean }) {
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
    <LeafInput schema={schema} raw={raw} onChange={onChange} label={label} />
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
  return <Text className="mono prop-value">{formatValue(value)}</Text>;
}

// --- Properties: live state rows ---------------------------------------

type ValueState = { status: 'loading' | 'ready' | 'error'; value?: unknown; error?: string; updatedAt?: number };

function PropertyRow({ property, state, onWrite }: { property: Property; state: ValueState; onWrite: (value: unknown) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<RawValue>('');
  const [saving, setSaving] = useState(false);
  const structured = property.type === 'object' || property.type === 'array';

  function startEditing() {
    setDraft(valueToRaw(property.schema, state.value));
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    try { await onWrite(coerceTree(property.schema, draft)); setEditing(false); }
    finally { setSaving(false); }
  }

  return <tr>
    <td><AffordanceName name={property.name} title={property.title} description={property.description} /></td>
    <td>
      {editing ? <Stack gap="condensed" align="start">
        <SchemaInput schema={property.schema} raw={draft} onChange={setDraft} label={structured ? property.name : undefined} />
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
                : <Text key={state.updatedAt} className={`prop-value${property.observable ? ' prop-value-flash' : ''}`}>{formatValue(state.value)}</Text>}
          {property.writable && state.status !== 'loading' && <Button size="small" variant="invisible" onClick={startEditing}>Edit</Button>}
        </Stack>
        {property.observable && state.status === 'ready' && <Stack direction="horizontal" gap="condensed" align="center">
          <span className="live-dot" aria-hidden="true" title="Observable — this value updates live, no manual read needed" />
          <Text size="small" className="muted">live · updated {state.updatedAt ? <RelativeTime date={new Date(state.updatedAt)} /> : 'now'}</Text>
        </Stack>}
      </Stack>}
    </td>
    <td>
      <Stack direction="horizontal" gap="condensed" align="center" wrap="wrap">
        <TypeBadge schema={property.schema} />
        <Text as="span" size="small" className="muted" title={property.writable ? 'Writable — you can set a new value' : 'Read-only — this property cannot be written from here'}>
          {property.writable ? 'writable' : 'read-only'}
        </Text>
      </Stack>
    </td>
  </tr>;
}

// --- Actions: invocation rows (main row + optional result subrow) -------

type ActionResult = { status: number; text: string; value?: unknown; hasValue: boolean } | null;

function ActionRows({ thingId, action }: { thingId: string; action: Action }) {
  const [raw, setRaw] = useState<RawValue>(() => defaultRaw(action.input));
  const [result, setResult] = useState<ActionResult>(null);
  const [pending, setPending] = useState(false);

  async function invoke() {
    setPending(true);
    setResult(null);
    try {
      const body = action.input ? coerceTree(action.input, raw) : undefined;
      const response = await fetch(apiUrl(`/${encodeURIComponent(thingId)}/actions/${encodeURIComponent(action.name)}`), {
        method: 'POST',
        headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
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
    <tr className={showBody ? 'has-subrow' : undefined}>
      <td><AffordanceName name={action.name} title={action.title} description={action.description} /></td>
      <td>{action.input
        ? <Stack gap="condensed" align="start" className="action-input">
            <TypeBadge schema={action.input} />
            <SchemaInput schema={action.input} raw={raw} onChange={setRaw} />
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
    {showBody && <tr className="subrow"><td colSpan={4}>
      {structuredValue
        ? <div className="result"><SchemaValue schema={action.output} value={result?.value} /></div>
        : <Text as="pre" className="result">{result?.text}</Text>}
    </td></tr>}
  </>;
}

// --- Events: subscription rows (main row + streaming log subrow) --------

function EventRows({ thingId, event }: { thingId: string; event: EventAffordance }) {
  const [subscribed, setSubscribed] = useState(false);
  const [log, setLog] = useState<{ at: number; data: string }[]>([]);

  useEffect(() => {
    if (!subscribed) return;
    const controller = new AbortController();
    (async () => {
      while (!controller.signal.aborted) {
        try {
          const response = await fetch(apiUrl(`/${encodeURIComponent(thingId)}/events/${encodeURIComponent(event.name)}`), { headers: { Accept: 'application/json' }, signal: controller.signal });
          const text = await response.text();
          let data = text;
          try { data = JSON.stringify(JSON.parse(text)); } catch { /* plain text */ }
          setLog(current => [{ at: Date.now(), data: data || '(no payload)' }, ...current].slice(0, 50));
        } catch (cause) {
          if (controller.signal.aborted) return;
          try { await delay(1000, controller.signal); } catch { return; }
        }
      }
    })();
    return () => controller.abort();
  }, [subscribed, thingId, event.name]);

  return <>
    <tr className="has-subrow">
      <td><AffordanceName name={event.name} title={event.title} description={event.description} id={`event-${event.name}`} /></td>
      <td><TypeBadge schema={event.data} /></td>
      <td className="cell-shrink">
        <Stack direction="horizontal" align="center">
          <ToggleSwitch size="small" checked={subscribed} onClick={() => setSubscribed(value => !value)} aria-labelledby={`event-${event.name}`} />
        </Stack>
      </td>
    </tr>
    <tr className="subrow"><td colSpan={3}><pre className="event-log">{log.length
      ? log.map(entry => `${new Date(entry.at).toLocaleTimeString()}  ${entry.data}`).join('\n')
      : <span className="event-log-empty">{subscribed ? 'Waiting for events…' : 'Subscribe to stream events.'}</span>}</pre></td></tr>
  </>;
}

// --- Thing inspector ----------------------------------------------------

function AffordanceTable({ caption, headers, modifier, children }: { caption: string; headers: string[]; modifier?: 'grow' | 'actions'; children: React.ReactNode }) {
  return <Stack gap="condensed">
    <Text size="small" className="muted">{caption}</Text>
    <div className="table-scroll">
      <table className={`aff-table${modifier ? ` aff-table--${modifier}` : ''}`}>
        <thead><tr>{headers.map(header => <th key={header}>{header}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  </Stack>;
}

function ThingInspector({ thing, section, onSection }: { thing: ThingModel; section: Section | null; onSection: (section: Section, options?: { replace?: boolean }) => void }) {
  const [values, setValues] = useState<Record<string, ValueState>>({});

  const kinds = ([['properties', thing.properties.length], ['actions', thing.actions.length], ['events', thing.events.length]] as [Section, number][])
    .filter(([, count]) => count > 0);
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

    const readOnce = async (property: Property) => {
      try {
        const value = await requestJson<unknown>(apiUrl(`/${encodeURIComponent(thing.id)}/properties/${encodeURIComponent(property.name)}`), controller.signal);
        setValue(property.name, { status: 'ready', value, updatedAt: Date.now() });
      } catch (cause) {
        if (controller.signal.aborted) return;
        setValue(property.name, { status: 'error', error: cause instanceof Error ? cause.message : 'unreadable' });
      }
    };

    const observe = async (property: Property) => {
      while (!controller.signal.aborted) {
        try {
          const value = await requestJson<unknown>(apiUrl(`/${encodeURIComponent(thing.id)}/properties/${encodeURIComponent(property.name)}/observable`), controller.signal);
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

  async function writeProperty(property: Property, value: unknown) {
    await fetch(apiUrl(`/${encodeURIComponent(thing.id)}/properties/${encodeURIComponent(property.name)}`), {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value)
    });
    if (!property.observable) {
      try {
        const fresh = await requestJson<unknown>(apiUrl(`/${encodeURIComponent(thing.id)}/properties/${encodeURIComponent(property.name)}`));
        setValue(property.name, { status: 'ready', value: fresh, updatedAt: Date.now() });
      } catch { /* leave prior value */ }
    }
  }

  return <Stack gap="spacious">
    <Stack gap="condensed">
      <Text className="mono field-label" as="div">{thing.id}</Text>
      <Heading as="h2">{thing.title}</Heading>
      {thing.description && <Text className="muted" style={{ maxWidth: '60ch' }}>{thing.description}</Text>}
    </Stack>

    <Stack gap="normal">
      <Text className="eyebrow" as="div">Interaction Affordances</Text>
      <UnderlineNav aria-label="Interaction affordances">
        {kinds.map(([kind, count]) => (
          <UnderlineNav.Item key={kind} href={`/${encodeURIComponent(thing.id)}/${kind}`} counter={count}
            aria-current={kind === active ? 'page' : undefined}
            onSelect={event => { event.preventDefault(); onSection(kind); }}>
            {sectionLabel[kind]}
          </UnderlineNav.Item>
        ))}
      </UnderlineNav>

      {active === 'properties' && <AffordanceTable
        caption="Readable state. Values marked live (●) update on their own; read-only properties can't be written from here."
        headers={['Property', 'Value', 'Type']}>
        {thing.properties.map(property => (
          <PropertyRow key={property.name} property={property}
            state={values[property.name] ?? { status: 'loading' }}
            onWrite={value => writeProperty(property, value)} />
        ))}
      </AffordanceTable>}

      {active === 'actions' && <AffordanceTable modifier="actions"
        caption="Operations you invoke. Provide any input, then Invoke; the returned output (if any) appears below the row."
        headers={['Action', 'Input', 'Output', 'Invoke']}>
        {thing.actions.map(action => <ActionRows key={action.name} thingId={thing.id} action={action} />)}
      </AffordanceTable>}

      {active === 'events' && <AffordanceTable modifier="grow"
        caption="Notifications the Thing pushes. Toggle Subscribe to open a live stream; emitted events appear in the log below."
        headers={['Event', 'Data', 'Subscribe']}>
        {thing.events.map(event => <EventRows key={event.name} thingId={thing.id} event={event} />)}
      </AffordanceTable>}
    </Stack>
  </Stack>;
}

// --- Landing page -------------------------------------------------------

function Landing({ things, loading, onOpen }: { things: ThingEntry[]; loading: boolean; onOpen: (id: string) => void }) {
  return <Stack gap="spacious">
    <Stack gap="condensed">
      <Text className="eyebrow eyebrow-accent" as="div">Overview</Text>
      <Heading as="h2"><Stack direction="horizontal" align="center" gap="condensed"><BeakerIcon size={28} />WoT Lab</Stack></Heading>
      <Text className="muted" style={{ maxWidth: '52ch' }}>
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
                  <Text className="mono field-label">{entry.id}</Text>
                </button>
              ))}
            </div>
          : <Text className="muted">No Things are currently exposed.</Text>}
    </Stack>

    <CreateThingGuide />
  </Stack>;
}

// Real, abridged source of the bundled Counter Thing (src/things/counter/),
// shown as worked examples. Counter needs no logic.js: its actions carry their
// behavior declaratively as `vre:effects` right in the Thing Description.
const counterTd = `{
  "title": "Counter",
  "description": "Counter example Thing",
  "@context": [
    "https://www.w3.org/2019/wot/td/v1",
    "https://www.w3.org/2022/wot/td/v1.1"
  ],
  "properties": {
    "count": {
      "title": "Count",
      "type": "integer",
      "description": "Current counter value",
      "observable": true,
      "readOnly": true
    }
  },
  "actions": {
    "increment": {
      "title": "Increment",
      "description": "Increment counter value",
      "vre:effects": "count' = count + 1; emitEvent(\\"change\\", count);"
    },
    "reset": {
      "title": "Reset",
      "description": "Resetting counter value",
      "vre:effects": "count' = 0; emitEvent(\\"change\\", count);"
    }
  },
  "events": {
    "change": { "title": "Changed", "description": "Change event" }
  }
}`;

const counterState = `{
  "count": 0
}`;

// A filename-headed code panel, tokened to match the action/event result panels.
function CodeExample({ filename, code }: { filename: string; code: string }) {
  return <div className="code-example">
    <div className="code-example-head"><Text className="mono" size="small" weight="semibold">{filename}</Text></div>
    <pre className="code-example-body"><code>{code}</code></pre>
  </div>;
}

// A brief, tokened walk-through of the file layout that defines a new Thing,
// with the bundled Counter Thing as worked examples: TD + state required,
// logic.js optional (behavior can also be declared inline via vre:effects).
function CreateThingGuide() {
  const files: { name: string; required: boolean; description: React.ReactNode }[] = [
    { name: '<name>.td.json', required: true, description: 'W3C Thing Description — the properties, actions and events the Thing exposes.' },
    { name: 'state.json', required: true, description: 'Initial state object — Keys map to TD properties.' },
    { name: 'logic.js', required: false, description: <>Imperative behavior — wires read/action handlers and event emitters declared in JavaScript.</> }
  ];
  return <Stack gap="normal">
    <Stack direction="horizontal" align="center" gap="condensed">
      <Heading as="h3" style={{ fontSize: 18 }}>Creating new Things</Heading>
    </Stack>
    <Text className="muted" style={{ maxWidth: '60ch' }}>
      Add a directory under <InlineCode>src/things/&lt;name&gt;/</InlineCode> and the Thing is
      auto-discovered on the next start. A Thing needs a Thing Description with VRE effect annotations (<InlineCode>vre:effects</InlineCode>) and an initial
      state; logic.js is optional.
    </Text>
    <div className="file-tree">
      <div className="file-tree-root"><FileDirectoryIcon /> <Text className="mono" weight="semibold">src/things/&lt;name&gt;/</Text></div>
      <Stack gap="condensed">
        {files.map(file => (
          <Stack key={file.name} direction="horizontal" gap="condensed" align="start" className="file-tree-row">
            <Text className="mono" weight="semibold">{file.name}</Text>
            <Label variant={file.required ? 'accent' : 'secondary'}>{file.required ? 'required' : 'optional'}</Label>
            <Text size="small" className="muted file-tree-desc">{file.description}</Text>
          </Stack>
        ))}
      </Stack>
    </div>

    <Stack gap="condensed">
      <Text weight="semibold">Example: the Counter Thing</Text>
      <Text size="small" className="muted" style={{ maxWidth: '60ch' }}>
        Counter needs no <InlineCode>logic.js</InlineCode>. Its state is a single
        integer, and each action declares its behavior declaratively via <InlineCode>vre:effects</InlineCode>
        {' '} annotations in the Thing Description 
      </Text>
      <CodeExample filename="src/things/counter/counter.td.json" code={counterTd} />
      <CodeExample filename="src/things/counter/state.json" code={counterState} />
    </Stack>

    <Text size="small" className="muted">
      <Link href={`${repositoryUrl}/tree/master/src/things`} target="_blank" rel="noopener noreferrer">Browse all the example Things on GitHub ↗</Link>
    </Text>
  </Stack>;
}

// --- App shell ----------------------------------------------------------

const nextColorMode: Record<ColorMode, ColorMode> = { auto: 'light', light: 'dark', dark: 'auto' };
const colorModeIcon: Record<ColorMode, typeof SunIcon> = { auto: DeviceDesktopIcon, light: SunIcon, dark: MoonIcon };

function App() {
  const { route, navigate } = useRoute();
  const [colorMode, setColorMode] = useState<ColorMode>('auto');
  const [things, setThings] = useState<ThingEntry[]>([]);
  const [thing, setThing] = useState<ThingModel | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  async function loadThings() {
    setLoading(true); setError('');
    try {
      const data = await requestJson<{ things: ThingEntry[] }>(`${apiBase}/`);
      setThings(data.things);
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

  const ColorModeIcon = colorModeIcon[colorMode];
  const currentThing = thing && thing.id === route.thingId ? thing : null;

  return <ThemeProvider colorMode={colorMode} nightScheme="dark_dimmed">
    <BaseStyles className="app-root">
      <PageLayout containerWidth="full" padding="none" rowGap="none">
        <PageLayout.Header padding="condensed" divider="line">
          <Stack direction="horizontal" align="center" justify="space-between" gap="normal" wrap="wrap">
            <Stack direction="horizontal" align="center" gap="condensed">
              <button type="button" className="brand" onClick={() => navigate(null)}>
                <Stack direction="horizontal" align="center" gap="condensed">
                  <BeakerIcon size={24} />
                  <Heading as="h1" style={{ fontSize: 20 }}>WoT Lab <Text className="muted" weight="normal">Dashboard</Text></Heading>
                </Stack>
              </button>
              {currentThing && <>
                <span className="header-divider" aria-hidden="true" />
                <Heading as="h2" style={{ fontSize: 18 }}>{currentThing.title}</Heading>
              </>}
            </Stack>
            <Stack direction="horizontal" align="center" gap="normal" wrap="wrap">
              {currentThing && <Stack direction="horizontal" align="center" gap="normal" wrap="wrap">
                <Stack direction="horizontal" align="center" gap="condensed"><FieldLabel>id</FieldLabel><Text className="mono">{currentThing.id}</Text></Stack>
                {currentThing.atType && <Stack direction="horizontal" align="center" gap="condensed"><FieldLabel>@type</FieldLabel><Text className="mono">{currentThing.atType}</Text></Stack>}
                <Link as="button" type="button" onClick={() => void openThingDescription(currentThing.id)} muted>Thing Description ↗</Link>
                <span className="header-divider" aria-hidden="true" />
              </Stack>}
              <IconButton icon={ColorModeIcon} aria-label={`Color mode: ${colorMode}. Switch to ${nextColorMode[colorMode]}.`} variant="invisible" onClick={() => setColorMode(mode => nextColorMode[mode])} />
              <Button leadingVisual={SyncIcon} onClick={() => void loadThings()}>Refresh</Button>
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
                    <NavList.Item key={entry.id} aria-current={entry.id === route.thingId} onClick={() => navigate(entry.id)}>
                      {entry.title}
                    </NavList.Item>
                  ))}
                </NavList>
              : <Text className="muted">No Things exposed.</Text>}
        </PageLayout.Pane>

        <PageLayout.Content padding="normal">
          <div style={{ maxWidth: 960, marginInline: 'auto' }}>
            {error && <Flash variant="danger">{error}</Flash>}
            {route.thingId
              ? thing && thing.id === route.thingId
                ? <ThingInspector key={thing.id} thing={thing} section={route.section} onSection={(s, options) => navigate(thing.id, s, options)} />
                : !error && <Stack align="center" padding="spacious"><Spinner /></Stack>
              : <Landing things={things} loading={loading} onOpen={id => navigate(id)} />}
          </div>
        </PageLayout.Content>
      </PageLayout>
    </BaseStyles>
  </ThemeProvider>;
}

export default App;
