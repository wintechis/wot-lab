import { GoalPredicate, PlanStep, Task, apiUrl, labReset, labSetState } from './api';

// --- The run file ---------------------------------------------------------
// A run is a sequence of Action invocations from a task's initial state. A step
// has the shape of a task's `optimalPlan` entry on purpose: a plan already is a
// run, so a plan, a distractor and an agent's attempt replay through one path.
// Things are named by instance id, never by URL, so a file is valid on any host.

// What a harness saw when it made the step. Replay ignores both; they are shown
// beside what the replay got.
export type RunStep = PlanStep & { status?: number; output?: unknown };

export type Run = {
  environment: string;
  // The record in the environment's tasks.json that supplies `initialState` and
  // `goal`. A run does not copy them: a copy can contradict the record.
  task?: string;
  agent?: string;
  model?: string;
  timestamp?: string;
  // Used only when `task` is absent.
  initialState?: Record<string, Record<string, unknown>>;
  goal?: GoalPredicate[];
  steps: RunStep[];
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function toRun(value: unknown, label: string): Run {
  if (!isObject(value)) throw new Error(`${label}: expected a JSON object`);
  if (typeof value.environment !== 'string' || !value.environment) throw new Error(`${label}: "environment" is required`);
  if (!Array.isArray(value.steps)) throw new Error(`${label}: "steps" must be an array`);
  if (value.task !== undefined && typeof value.task !== 'string') throw new Error(`${label}: "task" must be a task id`);
  if (value.goal !== undefined && !Array.isArray(value.goal)) throw new Error(`${label}: "goal" must be an array`);
  if (value.initialState !== undefined && !isObject(value.initialState)) throw new Error(`${label}: "initialState" must be an object`);

  const steps: RunStep[] = [];
  value.steps.forEach((step: unknown, index: number) => {
    if (!isObject(step)) throw new Error(`${label}: step ${index + 1} is not an object`);
    // A harness may log its reads among the steps. They change nothing by
    // construction and are not part of a run, so they are dropped here.
    if (step.op === 'read') return;
    if (typeof step.thing !== 'string' || typeof step.action !== 'string') {
      throw new Error(`${label}: step ${index + 1} needs a "thing" and an "action"`);
    }
    steps.push(step as RunStep);
  });
  return { ...(value as Run), steps };
}

// One run, a JSON array of runs, or JSONL with a run per line.
export function parseRuns(text: string): Run[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
    if (lines.length < 2) throw new Error(`Not valid JSON: ${(cause as Error).message}`);
    return lines.map((line, index) => {
      try { return toRun(JSON.parse(line), `Line ${index + 1}`); } catch (inner) {
        throw new Error(inner instanceof SyntaxError ? `Line ${index + 1} is not valid JSON` : (inner as Error).message);
      }
    });
  }
  if (Array.isArray(parsed)) {
    if (!parsed.length) throw new Error('The file holds no runs');
    return parsed.map((entry, index) => toRun(entry, `Run ${index + 1}`));
  }
  return [toRun(parsed, 'Run')];
}

export const runFromPlan = (task: Task, steps: PlanStep[], agent: string): Run =>
  ({ environment: task.environment, task: task.id, agent, steps });

// --- Goal satisfaction ------------------------------------------------------
// The operators of tools/verify_tasks.py, with its deep equality.

function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, index) => equal(item, b[index]));
  if (isObject(a) && isObject(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(key => key in b && equal(a[key], b[key]));
  }
  return false;
}

export function satisfied(actual: unknown, goal: GoalPredicate): boolean {
  const expected = goal.value;
  const ordered = (typeof actual === 'number' && typeof expected === 'number') || (typeof actual === 'string' && typeof expected === 'string');
  switch (goal.op) {
    case '=': return equal(actual, expected);
    case '!=': return !equal(actual, expected);
    case '<': return ordered && (actual as number) < (expected as number);
    case '<=': return ordered && (actual as number) <= (expected as number);
    case '>': return ordered && (actual as number) > (expected as number);
    case '>=': return ordered && (actual as number) >= (expected as number);
    case 'length': return Array.isArray(actual) && actual.length === expected;
    case 'contains': return Array.isArray(actual) && actual.some(item => equal(item, expected));
    default: throw new Error(`Unknown goal operator '${goal.op}'`);
  }
}

// --- Replay -----------------------------------------------------------------

// One goal predicate as it stands in a state: what was read, and whether it holds.
export type PredicateReading = { actual: unknown; holds: boolean; error?: string };

// A state of the run: S0 before any step, then one per invocation.
export type ReplayState = {
  index: number;
  step?: RunStep;
  ok?: boolean;
  status?: number;
  output?: unknown;
  readings: PredicateReading[];
  // Indexes into the goal whose value differs from the state before.
  changed: number[];
  holding: number;
};

// wot-lab's conventional paths, as tools/verify_tasks.py uses them: a run names
// Things by id, and these are the paths an id is served under.
const propertyUrl = (goal: GoalPredicate) =>
  apiUrl(`/${encodeURIComponent(goal.thing)}/properties/${encodeURIComponent(goal.property)}`);

async function readGoal(goal: GoalPredicate[], signal: AbortSignal): Promise<PredicateReading[]> {
  // A goal often names one property several times (a range is two predicates).
  const reads = new Map<string, Promise<{ actual: unknown; error?: string }>>();
  const read = (predicate: GoalPredicate) => {
    const url = propertyUrl(predicate);
    let pending = reads.get(url);
    if (!pending) {
      pending = fetch(url, { headers: { Accept: 'application/json' }, signal }).then(async response => {
        if (!response.ok) return { actual: undefined, error: `${response.status} ${response.statusText}` };
        return { actual: await response.json() as unknown };
      });
      reads.set(url, pending);
    }
    return pending;
  };
  return Promise.all(goal.map(async predicate => {
    const { actual, error } = await read(predicate);
    return { actual, error, holds: !error && satisfied(actual, predicate) };
  }));
}

// `{}` is how a plan writes "this Action takes no input".
export const hasNoInput = (step: PlanStep): boolean =>
  step.input === undefined || (isObject(step.input) && !Object.keys(step.input).length);

async function invoke(step: RunStep, signal: AbortSignal): Promise<{ ok: boolean; status: number; output: unknown }> {
  // No input is sent as no body at all, not as an empty object.
  const none = hasNoInput(step);
  const response = await fetch(apiUrl(`/${encodeURIComponent(step.thing)}/actions/${encodeURIComponent(step.action)}`), {
    method: 'POST',
    headers: none ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: none ? undefined : JSON.stringify(step.input),
    signal
  });
  const text = await response.text();
  let output: unknown = text || undefined;
  try { if (text) output = JSON.parse(text); } catch { /* not JSON: keep the text */ }
  // An Action can refuse in its output while the protocol reports success.
  const refused = isObject(output) && output.success === false;
  return { ok: response.ok && !refused, status: response.status, output };
}

/**
 * Replay a run: reset the lab, inject the initial state, then make every
 * invocation in order, reading the goal after each. A failing step does not
 * stop the replay — an agent's run may hold failures, and they are what is
 * being looked at.
 */
export async function replayRun(
  run: Run,
  conditions: { initialState: Record<string, Record<string, unknown>>; goal: GoalPredicate[] },
  onState: (state: ReplayState) => void,
  signal: AbortSignal
): Promise<void> {
  const reset = await labReset();
  if (!reset.ok) throw new Error(reset.body.error || 'Reset failed');
  for (const [id, values] of Object.entries(conditions.initialState)) {
    const result = await labSetState(id, values);
    if (!result.ok) throw new Error(result.body.error || `Could not set the initial state of '${id}'`);
  }

  let readings = await readGoal(conditions.goal, signal);
  onState({ index: 0, readings, changed: [], holding: readings.filter(reading => reading.holds).length });

  for (const [position, step] of run.steps.entries()) {
    if (signal.aborted) return;
    let result: { ok: boolean; status?: number; output: unknown };
    try {
      result = await invoke(step, signal);
    } catch (cause) {
      if (signal.aborted) return;
      result = { ok: false, output: (cause as Error).message };
    }
    const next = await readGoal(conditions.goal, signal);
    const changed = next.flatMap((reading, index) => equal(reading.actual, readings[index].actual) ? [] : [index]);
    readings = next;
    onState({ index: position + 1, step, ...result, readings, changed, holding: readings.filter(reading => reading.holds).length });
  }
}
