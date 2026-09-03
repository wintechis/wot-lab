import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Checkbox,
  Dialog,
  Flash,
  IconButton,
  Link,
  Select,
  Spinner,
  Stack,
  Text,
  TextInput,
  Textarea,
  UnderlineNav
} from '@primer/react';
import { PlusIcon, TrashIcon } from '@primer/octicons-react';
import {
  ActionSpec,
  DataType,
  EventSpec,
  PropertySpec,
  SchemaSpec,
  ThingDraft,
  ThingSpec,
  ThingModel,
  createThings,
  createThingModel,
  validateThingModel
} from './api';
import { CodeExample } from './Json';

const dataTypes: DataType[] = ['boolean', 'integer', 'number', 'string', 'object', 'array'];

const isScalar = (type: DataType) => type !== 'object' && type !== 'array';

const newNode = (): SchemaSpec => ({ name: '', type: 'number' });

// Thing type names are directory names and become the URL of every instance, so
// they are slugs. Deriving one from the title is a convenience only — the field
// stays editable, and the server validates it either way.
function slug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Changing a node's type has to change its shape too: an object grows a member
// list, an array an item type, and a scalar loses both along with the value
// fields that only make sense for a scalar. Without this, switching type twice
// would leave a stale `items` on an object.
function retype(node: SchemaSpec, type: DataType): SchemaSpec {
  const next: SchemaSpec = { ...node, type };
  if (type === 'object') {
    next.properties = node.properties ?? [];
  } else {
    delete next.properties;
  }
  if (type === 'array') {
    next.items = node.items ?? { type: 'string' };
  } else {
    delete next.items;
  }
  if (!isScalar(type)) {
    delete next.initial;
    delete next.unit;
  }
  return next;
}

const emptySpec: ThingSpec = {
  name: '',
  title: '',
  description: '',
  properties: [{ name: '', type: 'number' }],
  actions: [],
  events: []
};

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <Stack gap="none" className="spec-field">
    <Text className="field-label">{label}</Text>
    {children}
    {hint && <Text size="small" className="muted">{hint}</Text>}
  </Stack>;
}

// A repeatable group of rows — properties, actions, events, object members.
// The rows and their add button sit inside one padded box so the group reads as
// a container you are adding into, rather than as loose rows on the page.
function Repeatable({ title, hint, addLabel, onAdd, children }: {
  title: string; hint?: string; addLabel: string; onAdd: () => void; children: React.ReactNode;
}) {
  return <Stack gap="condensed">
    <Stack direction="horizontal" align="baseline" gap="condensed" wrap="wrap">
      <Text className="eyebrow" as="div">{title}</Text>
      {hint && <Text size="small" className="muted">{hint}</Text>}
    </Stack>
    <div className="spec-group">
      <Stack gap="condensed" align="start">
        {children}
        <Button size="small" leadingVisual={PlusIcon} onClick={onAdd}>{addLabel}</Button>
      </Stack>
    </div>
  </Stack>;
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <IconButton icon={TrashIcon} variant="invisible" size="small" aria-label={label} onClick={onClick} />;
}

// An optional schema behind a checkbox — an action's output, an event's payload.
function OptionalSchema({ label, node, onChange }: {
  label: string; node?: SchemaSpec; onChange: (next?: SchemaSpec) => void;
}) {
  return <Stack gap="condensed">
    <Stack direction="horizontal" gap="condensed" align="center">
      <Checkbox checked={Boolean(node)} aria-label={label}
        onChange={event => onChange(event.target.checked ? { type: 'string' } : undefined)} />
      <Text size="small" className="muted">{label}</Text>
    </Stack>
    {node && <div className="spec-nested">
      <SchemaEditor node={node} named={false} variant="io" onChange={next => onChange(next)} />
    </div>}
  </Stack>;
}

/**
 * The datatype editor, recursive because the datatype is.
 *
 * One component covers a Thing property, a member of an object, an array's item
 * type, an action parameter, an action output and an event payload — in a Thing
 * Description those are all the same node, so editing them differently would be
 * an accident of the form rather than a real distinction.
 *
 * `variant` says whether this tree describes stored state (a property, which
 * needs a unit and a starting value) or a value in flight (an input or output,
 * which does not). `depth` is only used to keep read-only on the affordance
 * itself, where the Thing Description puts it.
 */
function SchemaEditor({ node, onChange, onRemove, named, variant, depth = 0 }: {
  node: SchemaSpec;
  onChange: (next: SchemaSpec) => void;
  onRemove?: () => void;
  named: boolean;
  variant: 'property' | 'io';
  depth?: number;
}) {
  const members = node.properties ?? [];
  const showValueFields = variant === 'property' && isScalar(node.type);

  return <Stack gap="condensed" className="spec-node">
    <Stack direction="horizontal" gap="condensed" align="center" wrap="wrap">
      {named && <TextInput aria-label="Name" placeholder="name" className="spec-name" value={node.name ?? ''}
        onChange={event => onChange({ ...node, name: event.target.value })} />}
      <Select aria-label="Data type" value={node.type}
        onChange={event => onChange(retype(node, event.target.value as DataType))}>
        {dataTypes.map(type => <Select.Option key={type} value={type}>{type}</Select.Option>)}
      </Select>
      {showValueFields && <>
        <TextInput aria-label="Unit" placeholder="unit" className="spec-small" value={node.unit ?? ''}
          onChange={event => onChange({ ...node, unit: event.target.value })} />
        <TextInput aria-label="Initial value" placeholder="initial" className="spec-small" value={String(node.initial ?? '')}
          onChange={event => onChange({ ...node, initial: event.target.value })} />
      </>}
      {variant === 'property' && depth === 0 && <Stack direction="horizontal" gap="condensed" align="center">
        <Checkbox checked={node.readOnly === true} aria-label="Read only"
          onChange={event => onChange({ ...node, readOnly: event.target.checked })} />
        <Text size="small" className="muted">read-only</Text>
      </Stack>}
      {onRemove && <RemoveButton label={`Remove ${node.name || 'entry'}`} onClick={onRemove} />}
    </Stack>

    {node.type === 'object' && <div className="spec-nested">
      <Repeatable title="Properties" addLabel="Property"
        onAdd={() => onChange({ ...node, properties: [...members, newNode()] })}>
        {members.map((member, index) => <SchemaEditor key={index} node={member} named variant={variant} depth={depth + 1}
          onChange={next => onChange({ ...node, properties: members.map((existing, other) => other === index ? next : existing) })}
          onRemove={() => onChange({ ...node, properties: members.filter((_, other) => other !== index) })} />)}
      </Repeatable>
    </div>}

    {node.type === 'array' && <div className="spec-nested">
      <Text className="eyebrow" as="div">Item type</Text>
      <SchemaEditor node={node.items ?? { type: 'string' }} named={false} variant={variant} depth={depth + 1}
        onChange={next => onChange({ ...node, items: next })} />
    </div>}
  </Stack>;
}

function ActionRow({ action, onChange, onRemove }: {
  action: ActionSpec; onChange: (next: ActionSpec) => void; onRemove: () => void;
}) {
  const params = action.input ?? [];
  return <div className="spec-block"><Stack gap="condensed">
    <Stack direction="horizontal" gap="condensed" align="center" wrap="wrap">
      <TextInput aria-label="Action name" placeholder="name" className="spec-name" value={action.name}
        onChange={event => onChange({ ...action, name: event.target.value })} />
      <TextInput aria-label="Action title" placeholder="title" value={action.title ?? ''}
        onChange={event => onChange({ ...action, title: event.target.value })} />
      <RemoveButton label={`Remove action ${action.name || ''}`} onClick={onRemove} />
    </Stack>

    <Repeatable title="Input" hint="named parameters an effect can refer to" addLabel="Parameter"
      onAdd={() => onChange({ ...action, input: [...params, newNode()] })}>
      {params.map((param, index) => <SchemaEditor key={index} node={param} named variant="io"
        onChange={next => onChange({ ...action, input: params.map((existing, other) => other === index ? next : existing) })}
        onRemove={() => onChange({ ...action, input: params.filter((_, other) => other !== index) })} />)}
    </Repeatable>

    <OptionalSchema label="output" node={action.output} onChange={output => onChange({ ...action, output })} />

    {/* Behavior is a VRE effect program, not JavaScript: the server compiles it
        and reports errors here, and nothing typed in this box is ever executed
        as code. */}
    <Textarea aria-label={`Effects for ${action.name || 'action'}`} rows={2} className="spec-effects"
      placeholder="level' = level + 1; emitEvent(&quot;changed&quot;, level);"
      value={action.effects ?? ''}
      onChange={event => onChange({ ...action, effects: event.target.value })} />
  </Stack></div>;
}

function EventRow({ event, onChange, onRemove }: {
  event: EventSpec; onChange: (next: EventSpec) => void; onRemove: () => void;
}) {
  return <div className="spec-block"><Stack gap="condensed">
    <Stack direction="horizontal" gap="condensed" align="center" wrap="wrap">
      <TextInput aria-label="Event name" placeholder="name" className="spec-name" value={event.name}
        onChange={next => onChange({ ...event, name: next.target.value })} />
      <TextInput aria-label="Event title" placeholder="title" value={event.title ?? ''}
        onChange={next => onChange({ ...event, title: next.target.value })} />
      <RemoveButton label={`Remove event ${event.name || ''}`} onClick={onRemove} />
    </Stack>
    <OptionalSchema label="data" node={event.data} onChange={data => onChange({ ...event, data })} />
  </Stack></div>;
}

// --- Add an instance of an existing type --------------------------------

function FromModelTab({ models, busy, onCreate }: {
  models: ThingModel[]; busy: boolean; onCreate: (model: string, count: number) => void;
}) {
  const [model, setModel] = useState(models[0]?.name ?? '');
  const [count, setCount] = useState('1');
  const selected = models.find(candidate => candidate.name === model);

  useEffect(() => {
    if (!models.some(candidate => candidate.name === model)) setModel(models[0]?.name ?? '');
  }, [models, model]);

  if (!models.length) return <Text className="muted">No Thing Models are available on disk.</Text>;

  return <Stack gap="normal">
    <Text className="muted">
      Create Things from a Thing Model that already exists. They go live immediately;
      Things are not written anywhere, so a restart starts from the flags again.
    </Text>
    <Stack direction="horizontal" gap="normal" align="end" wrap="wrap">
      <Field label="Thing Model">
        <Select aria-label="Thing Model" value={model} onChange={event => setModel(event.target.value)}>
          {models.map(candidate => <Select.Option key={candidate.name} value={candidate.name}>{candidate.title} ({candidate.name})</Select.Option>)}
        </Select>
      </Field>
      <Field label="Things">
        <TextInput aria-label="How many Things" type="number" min={1} max={50} className="spec-small"
          value={count} onChange={event => setCount(event.target.value)} />
      </Field>
      <Button variant="primary" disabled={busy || !model} onClick={() => onCreate(model, Math.max(1, Number(count) || 1))}>
        {busy ? 'Creating…' : 'Create'}
      </Button>
    </Stack>
    {selected?.description && <Text size="small" className="muted">{selected.description}</Text>}
  </Stack>;
}

// --- Author a new Thing Model --------------------------------------------

function NewModelTab({ busy, onCreate }: { busy: boolean; onCreate: (payload: { spec?: ThingSpec; draft?: ThingDraft }) => void }) {
  const [spec, setSpec] = useState<ThingSpec>(emptySpec);
  const [nameEdited, setNameEdited] = useState(false);
  // Non-null once the JSON escape hatch is open. The sync is deliberately
  // one-way: hand-edited JSON is the source of truth from then on, because
  // round-tripping it back through the form would silently drop any TD term the
  // form has no control for.
  const [json, setJson] = useState<{ td: string; state: string } | null>(null);
  const [draft, setDraft] = useState<ThingDraft | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [checking, setChecking] = useState(false);

  const name = nameEdited ? spec.name : slug(spec.title);

  const payload = useMemo((): { spec?: ThingSpec; draft?: ThingDraft } | { parseError: string } => {
    if (!json) return { spec: { ...spec, name } };
    try {
      return { draft: { name, td: JSON.parse(json.td), state: JSON.parse(json.state) } };
    } catch (cause) {
      return { parseError: cause instanceof Error ? cause.message : 'Invalid JSON' };
    }
  }, [json, spec, name]);

  useEffect(() => {
    if ('parseError' in payload) {
      setErrors([payload.parseError]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setChecking(true);
      try {
        const result = await validateThingModel(payload, controller.signal);
        setDraft(result.body.draft ?? null);
        setErrors(result.body.errors ?? (result.body.error ? [result.body.error] : []));
      } catch {
        if (!controller.signal.aborted) setErrors(['Unable to reach the lab API.']);
      } finally {
        if (!controller.signal.aborted) setChecking(false);
      }
    }, 400);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [payload]);

  const patch = useCallback((changes: Partial<ThingSpec>) => setSpec(current => ({ ...current, ...changes })), []);
  const ready = Boolean(name && spec.title) || Boolean(json);

  return <Stack gap="normal">
    <Text className="muted">
      Writes the Thing Model <Text as="span" className="mono">src/things/{name || '<name>'}/</Text> and
      creates one Thing from it. The files stay on disk, so the model is available to every later session.
    </Text>

    <Stack direction="horizontal" gap="normal" wrap="wrap">
      <Field label="Title"><TextInput aria-label="Thing title" placeholder="Desk Fan" value={spec.title}
        onChange={event => patch({ title: event.target.value })} /></Field>
      <Field label="Name" hint="directory and URL">
        <TextInput aria-label="Thing name" placeholder="desk-fan" className="mono" value={name}
          onChange={event => { setNameEdited(true); patch({ name: event.target.value }); }} />
      </Field>
    </Stack>
    <Field label="Description">
      <TextInput aria-label="Thing description" className="spec-wide" value={spec.description ?? ''}
        onChange={event => patch({ description: event.target.value })} />
    </Field>

    {json
      ? <Stack gap="condensed">
          <Flash variant="warning">
            Editing the files directly. The form above no longer drives them —
            <Link as="button" onClick={() => setJson(null)}> go back to the form</Link> to discard these edits.
          </Flash>
          <Field label={`${name || 'thing'}.td.json`}>
            <Textarea aria-label="Thing Description JSON" rows={14} className="spec-json mono" value={json.td}
              onChange={event => setJson({ ...json, td: event.target.value })} />
          </Field>
          <Field label="state.json">
            <Textarea aria-label="State JSON" rows={5} className="spec-json mono" value={json.state}
              onChange={event => setJson({ ...json, state: event.target.value })} />
          </Field>
        </Stack>
      : <Stack gap="normal">
          <Repeatable title="Properties" hint="readable state; objects and arrays nest"
            addLabel="Property" onAdd={() => patch({ properties: [...spec.properties, { name: '', type: 'number' }] })}>
            {spec.properties.map((property, index) => <SchemaEditor key={index} node={property} named variant="property"
              onChange={next => patch({ properties: spec.properties.map((existing, other) => other === index ? { ...next, name: next.name ?? '' } : existing) })}
              onRemove={() => patch({ properties: spec.properties.filter((_, other) => other !== index) })} />)}
          </Repeatable>

          <Repeatable title="Actions" hint="behavior as VRE effects — primed names assign, e.g. speed' = speed"
            addLabel="Action" onAdd={() => patch({ actions: [...spec.actions, { name: '', effects: '' }] })}>
            {spec.actions.map((action, index) => <ActionRow key={index} action={action}
              onChange={next => patch({ actions: spec.actions.map((existing, other) => other === index ? next : existing) })}
              onRemove={() => patch({ actions: spec.actions.filter((_, other) => other !== index) })} />)}
          </Repeatable>

          <Repeatable title="Events" hint="emitted from an effect with emitEvent(&quot;name&quot;, value)"
            addLabel="Event" onAdd={() => patch({ events: [...spec.events, { name: '' }] })}>
            {spec.events.map((event, index) => <EventRow key={index} event={event}
              onChange={next => patch({ events: spec.events.map((existing, other) => other === index ? next : existing) })}
              onRemove={() => patch({ events: spec.events.filter((_, other) => other !== index) })} />)}
          </Repeatable>
        </Stack>}

    {errors.length > 0 && <Flash variant="danger">
      <Stack gap="none">{errors.map(error => <Text key={error} size="small">{error}</Text>)}</Stack>
    </Flash>}

    {draft && !json && <Stack gap="condensed">
      <Stack direction="horizontal" align="center" gap="condensed">
        <Text className="eyebrow" as="div">Files to be written</Text>
        {checking && <Spinner size="small" />}
        <Button size="small" onClick={() => setJson({
          td: JSON.stringify(draft.td, null, 4),
          state: JSON.stringify(draft.state, null, 4)
        })}>Edit as JSON</Button>
      </Stack>
      <CodeExample filename={`src/things/${draft.name || 'thing'}/${draft.name || 'thing'}.td.json`} code={JSON.stringify(draft.td, null, 4)} />
      <CodeExample filename={`src/things/${draft.name || 'thing'}/state.json`} code={JSON.stringify(draft.state, null, 4)} />
    </Stack>}

    <Button variant="primary" disabled={busy || checking || !ready || errors.length > 0}
      onClick={() => { if (!('parseError' in payload)) onCreate(payload); }}>
      {busy ? 'Creating…' : 'Create Thing Model'}
    </Button>
  </Stack>;
}

// --- Dialog --------------------------------------------------------------

type Tab = 'model' | 'new';

export function CreateThingDialog({ models, onClose, onCreated }: {
  models: ThingModel[];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [tab, setTab] = useState<Tab>(models.length ? 'model' : 'new');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');

  async function run(work: () => Promise<{ ok: boolean; body: { error?: string; errors?: string[]; things?: { id: string }[] } }>) {
    setBusy(true);
    setFailure('');
    try {
      const result = await work();
      if (!result.ok) {
        setFailure(result.body.errors?.join('\n') || result.body.error || 'Request failed');
        return;
      }
      const created = result.body.things?.[0]?.id;
      onCreated(created ?? '');
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  }

  return <Dialog title="Add a Thing" width="xlarge" height="large" onClose={onClose}>
    <Stack gap="normal">
      <UnderlineNav aria-label="Add a Thing">
        <UnderlineNav.Item aria-current={tab === 'model' ? 'page' : undefined}
          onSelect={event => { event.preventDefault(); setTab('model'); }}>From a Thing Model</UnderlineNav.Item>
        <UnderlineNav.Item aria-current={tab === 'new' ? 'page' : undefined}
          onSelect={event => { event.preventDefault(); setTab('new'); }}>New Thing Model</UnderlineNav.Item>
      </UnderlineNav>

      {failure && <Flash variant="danger">{failure}</Flash>}

      {tab === 'model'
        ? <FromModelTab models={models} busy={busy} onCreate={(model, count) => void run(() => createThings(model, count))} />
        : <NewModelTab busy={busy} onCreate={payload => void run(() => createThingModel(payload))} />}
    </Stack>
  </Dialog>;
}
