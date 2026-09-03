import { useEffect, useState } from 'react';
import {
  ActionList,
  Button,
  Flash,
  FormControl,
  Heading,
  Label,
  PageLayout,
  Spinner,
  Stack,
  Text,
  TextInput
} from '@primer/react';
import { BeakerIcon, ChevronRightIcon, PlayIcon, SyncIcon } from '@primer/octicons-react';

type ThingEntry = { id: string; title: string; href: string };
type Schema = { type?: string; description?: string; default?: unknown; enum?: unknown[]; minimum?: number; maximum?: number; properties?: Record<string, Schema>; required?: string[] };
type Endpoint = { name: string; method: string; href: string; description: string; input?: Schema };
type Thing = { id: string; title: string; endpoints: Endpoint[] };
type ThingDescription = { id?: string; title?: string; properties?: Record<string, Schema & { title?: string; readOnly?: boolean; observable?: boolean }>; actions?: Record<string, Schema & { title?: string; input?: Schema }>; events?: Record<string, Schema & { title?: string }> };
type Result = { status: number; text: string } | null;

const apiBase = import.meta.env.DEV ? '/wot' : '';

const Box = (props: any) => {
  const { as: Component = 'div', sx: _sx, ...rest } = props;
  return <Component {...rest} />;
};

const apiUrl = (href: string) => {
  const url = new URL(href, window.location.origin);
  return `${apiBase}${url.pathname}${url.search}`;
};

async function requestJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json() as Promise<T>;
}

function thingFromDescription(description: ThingDescription, fallbackId: string): Thing {
  const id = (description.id || fallbackId).replace('urn:wot:', '');
  const endpoints: Endpoint[] = [];
  for (const [name, property] of Object.entries(description.properties || {})) {
    const href = `/${encodeURIComponent(id)}/properties/${encodeURIComponent(name)}`;
    endpoints.push({ name: `Read property: ${property.title || name}`, method: 'GET', href, description: property.description || 'Read a property value' });
    if (!property.readOnly) {
      endpoints.push({ name: `Write property: ${property.title || name}`, method: 'PUT', href, description: property.description || 'Write a property value', input: property });
    }
  }
  for (const [name, action] of Object.entries(description.actions || {})) {
    endpoints.push({ name: `Invoke action: ${action.title || name}`, method: 'POST', href: `/${encodeURIComponent(id)}/actions/${encodeURIComponent(name)}`, description: action.description || 'Invoke an action', input: action.input });
  }
  for (const [name, event] of Object.entries(description.events || {})) {
    endpoints.push({ name: `Subscribe to event: ${event.title || name}`, method: 'GET', href: `/${encodeURIComponent(id)}/events/${encodeURIComponent(name)}`, description: event.description || 'Subscribe to an event' });
  }
  return { id, title: description.title || id, endpoints };
}

function endpointKind(endpoint: Endpoint): 'property' | 'action' | 'other' {
  if (endpoint.name.startsWith('Read property:') || endpoint.name.startsWith('Write property:')) return 'property';
  if (endpoint.name.startsWith('Invoke action:')) return 'action';
  return 'other';
}

function Operation({ endpoint }: { endpoint: Endpoint }) {
  const [value, setValue] = useState('');
  const [result, setResult] = useState<Result>(null);
  const isWrite = endpoint.method === 'PUT';
  const isAction = endpoint.method === 'POST';
  const schema = endpoint.input;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setResult(null);
    let body: unknown;
    if (isWrite || isAction) {
      try { body = value ? JSON.parse(value) : undefined; } catch { body = value; }
    }
    const response = await fetch(apiUrl(endpoint.href), {
      method: endpoint.method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    let formatted = text;
    try { formatted = JSON.stringify(JSON.parse(text), null, 2); } catch { /* plain text response */ }
    setResult({ status: response.status, text: formatted || 'Request completed successfully.' });
  }

  return <Box className="operation" as="form" onSubmit={submit}>
    <Stack direction="horizontal" align="center" justify="space-between" gap="condensed">
      <Box><Text className="operation-name">{endpoint.name.replace(/^(Read|Write|Invoke) (property|action): /, '')}</Text><Text as="p" className="muted operation-description">{endpoint.description}</Text></Box>
      <Label variant={endpoint.method === 'GET' ? 'accent' : endpoint.method === 'POST' ? 'attention' : 'success'}>{endpoint.method}</Label>
    </Stack>
    {(isWrite || isAction) && schema && <FormControl className="field"><FormControl.Label>JSON value</FormControl.Label><TextInput block value={value} onChange={event => setValue(event.target.value)} placeholder={schema.type === 'object' ? '{ }' : String(schema.default ?? '')} /></FormControl>}
    <Button type="submit" leadingVisual={isAction ? PlayIcon : undefined}>{isAction ? 'Invoke action' : isWrite ? 'Write value' : 'Read value'}</Button>
    {result && <Box className="result"><Text className="operation-name">{result.status}</Text><Box as="pre">{result.text}</Box></Box>}
  </Box>;
}

function App() {
  const [things, setThings] = useState<ThingEntry[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [thing, setThing] = useState<Thing | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  async function loadThings() {
    setLoading(true); setError('');
    try {
      const data = await requestJson<{ things: ThingEntry[] }>(`${apiBase}/`);
      setThings(data.things); setSelectedId(current => current || data.things[0]?.id || '');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to reach WoT Lab.'); }
    finally { setLoading(false); }
  }

  useEffect(() => { void loadThings(); }, []);
  useEffect(() => {
    if (!selectedId) { setThing(null); return; }
    setError('');
    void requestJson<ThingDescription>(`${apiBase}/${encodeURIComponent(selectedId)}`).then(description => setThing(thingFromDescription(description, selectedId))).catch(cause => setError(cause instanceof Error ? cause.message : 'Unable to load Thing.'));
  }, [selectedId]);

  const properties = thing?.endpoints.filter(endpoint => endpointKind(endpoint) === 'property') ?? [];
  const actions = thing?.endpoints.filter(endpoint => endpointKind(endpoint) === 'action') ?? [];

  return <PageLayout containerWidth="full" padding="none">
    <PageLayout.Header><Box className="topbar"><Box className="brand"><BeakerIcon size={24} /><Heading as="h1">WoT Lab <Text as="span" className="brand-muted">Console</Text></Heading></Box><Button leadingVisual={SyncIcon} onClick={() => void loadThings()}>Refresh</Button></Box></PageLayout.Header>
    <PageLayout.Content><Box className="console-grid">
      <Box className="sidebar"><Text className="eyebrow">Exposed Things</Text>{loading ? <Spinner /> : <ActionList>{things.map(entry => <ActionList.Item key={entry.id} active={entry.id === selectedId} onSelect={() => setSelectedId(entry.id)}>{entry.title}<ActionList.TrailingVisual><ChevronRightIcon /></ActionList.TrailingVisual><Text as="span" className="thing-id">{entry.id}</Text></ActionList.Item>)}</ActionList>}{!loading && !things.length && <Text className="muted">No Things exposed.</Text>}</Box>
      <Box className="workspace">{error && <Flash variant="danger">{error}</Flash>}{thing ? <><Box className="hero"><Text className="eyebrow accent">Thing overview</Text><Heading as="h2">{thing.title}</Heading><Text className="muted">{thing.id} · {thing.endpoints.length} affordances</Text></Box><Heading as="h3" className="section-heading">Properties</Heading><Box className="operations">{properties.length ? properties.map(endpoint => <Operation key={endpoint.href} endpoint={endpoint} />) : <Text className="muted">This Thing has no writable properties.</Text>}</Box><Heading as="h3" className="section-heading actions-heading">Actions</Heading><Box className="operations">{actions.length ? actions.map(endpoint => <Operation key={endpoint.href} endpoint={endpoint} />) : <Text className="muted">This Thing has no actions.</Text>}</Box></> : !loading && !error && <Box className="empty"><BeakerIcon size={32} /><Heading as="h2">Select a Thing</Heading><Text className="muted">Choose an exposed device to inspect its Web of Things affordances.</Text></Box>}</Box>
    </Box></PageLayout.Content>
  </PageLayout>;
}

export default App;