// In dev the Vite server proxies /wot to the running lab; in the built app the
// dashboard is served by the lab itself, so paths are already same-origin.
export const apiBase = import.meta.env.DEV ? '/wot' : '';

export const apiUrl = (path: string) => `${apiBase}${path}`;

export async function requestJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { headers: { Accept: 'application/json' }, signal });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json() as Promise<T>;
}

// --- The lab API --------------------------------------------------------
// Everything that changes what is running goes through /_lab, which is the same
// registry the --things flag drives. A Thing created here is indistinguishable
// from one named on the command line.

// A Thing Model is what a Thing is made from: the Thing Description and initial
// state on disk, before any Thing exists.
export type ThingModel = { name: string; title: string; description?: string; hasLogic: boolean; writable: boolean };
export type LabThing = { id: string; model: string; title: string };
export type ThingDraft = { name: string; td: Record<string, unknown>; state: Record<string, unknown> };

export type DataType = 'boolean' | 'integer' | 'number' | 'string' | 'object' | 'array';

// One node of a declared datatype. The same shape describes a property, an
// object member, an array's item type, an action parameter or output, and an
// event payload — `properties` and `items` are what make it recursive.
export type SchemaSpec = {
  name?: string;
  type: DataType;
  title?: string;
  description?: string;
  unit?: string;
  readOnly?: boolean;
  observable?: boolean;
  initial?: string;
  properties?: SchemaSpec[];
  items?: SchemaSpec;
};

export type PropertySpec = SchemaSpec & { name: string };
export type ActionSpec = { name: string; title?: string; description?: string; input?: SchemaSpec[]; output?: SchemaSpec; effects?: string };
export type EventSpec = { name: string; title?: string; description?: string; data?: SchemaSpec };
export type ThingSpec = { name: string; title: string; description?: string; properties: PropertySpec[]; actions: ActionSpec[]; events: EventSpec[] };

export type LabResult<T> = { ok: boolean; status: number; body: T & { error?: string; errors?: string[] } };

async function send<T>(path: string, method: string, body?: unknown, signal?: AbortSignal): Promise<LabResult<T>> {
  const response = await fetch(apiUrl(path), {
    method,
    headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : {};
  return { ok: response.ok, status: response.status, body: parsed };
}

export const labThingModels = (signal?: AbortSignal) =>
  requestJson<{ thingModels: ThingModel[] }>(apiUrl('/_lab/thing-models'), signal);

// One collection, one shape: the running Things, plus the flag that recreates them.
export const labThings = (signal?: AbortSignal) =>
  requestJson<{ things: LabThing[]; startCommand: string }>(apiUrl('/_lab/things'), signal);

export const createThings = (model: string, count: number) =>
  send<{ things: LabThing[] }>('/_lab/things', 'POST', { model, count });

export const removeThing = (id: string, options?: { deleteFiles?: boolean; model?: string }) =>
  send<{ removed: boolean }>(
    `/_lab/things/${encodeURIComponent(id)}${options?.deleteFiles ? `?files=true&model=${encodeURIComponent(options.model ?? '')}` : ''}`,
    'DELETE'
  );

// The preview and the create call share one server-side code path, so what the
// dialog shows is exactly what would be written.
export const validateThingModel = (payload: { spec?: ThingSpec; draft?: ThingDraft }, signal?: AbortSignal) =>
  send<{ draft: ThingDraft; errors: string[] }>('/_lab/thing-models/validate', 'POST', payload, signal);

export const createThingModel = (payload: { spec?: ThingSpec; draft?: ThingDraft }) =>
  send<{ draft: ThingDraft; things: LabThing[] }>('/_lab/thing-models', 'POST', payload);
