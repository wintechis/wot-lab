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

export const removeAllThings = () => send<{ removed: string[] }>('/_lab/things', 'DELETE');

// --- Environments, tasks and the benchmark controls ---------------------
// An environment is a manifest on disk: a fixed set of Things under fixed ids.
// Its tasks say what a run starts from (`initialState`) and is judged by (`goal`).

// These mirror src/things/environments.ts by hand, as ThingSpec mirrors
// ThingAuthor: the dashboard and the lab type-check as separate projects.
export type EnvSummary = { name: string; description?: string; things: number; tasks: number };
export type GoalPredicate = { thing: string; property: string; op: string; value: unknown };
// One Action invocation: a step of a task's plan, and of a run. `input` is the
// real WoT payload — `{}` for an Action that takes none.
export type PlanStep = { thing: string; action: string; input?: unknown };
export type Task = {
  id: string; environment: string; level: string; request: string;
  goal: GoalPredicate[];
  initialState: Record<string, Record<string, unknown>>;
  optimalPlan: PlanStep[]; distractorPlan?: PlanStep[]; naiveAttempt?: PlanStep[];
  note?: string;
};

export const labEnvironments = (signal?: AbortSignal) =>
  requestJson<{ current?: string; environments: EnvSummary[] }>(apiUrl('/_lab/environments'), signal);

// `replace` takes everything running offline first, so the lab is exactly the manifest.
export const startEnvironment = (name: string, replace: boolean) =>
  send<{ environment: string; things: LabThing[] }>('/_lab/environments', 'POST', { name, replace });

export const environmentTasks = (name: string, signal?: AbortSignal) =>
  requestJson<{ tasks: Task[] }>(apiUrl(`/_lab/environments/${encodeURIComponent(name)}/tasks`), signal);

export const labReset = (id?: string) => send<{ reset: string[] }>('/_lab/reset', 'POST', id ? { id } : {});

// Writes past TD writability — for constructing a task's initial conditions.
export const labSetState = (id: string, values: Record<string, unknown>) =>
  send<{ id: string; set: string[] }>('/_lab/state', 'POST', { id, values });
