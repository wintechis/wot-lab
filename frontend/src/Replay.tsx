import { memo, useEffect, useRef, useState } from 'react';
import { Button, Flash, FormControl, Heading, Label, Select, Spinner, Stack, Text } from '@primer/react';
import { HistoryIcon, PlayIcon, UploadIcon } from '@primer/octicons-react';

import { GoalPredicate, Task, environmentTasks, labEnvironments } from './api';
import { replaceWithEnvironment } from './Environments';
import { HighlightedJson, InlineCode } from './Json';
import { ReplayState, Run, hasNoInput, parseRuns, replayRun, runFromPlan } from './replay';

// A 600-step run is a real case (producing a smartphone on the shopfloor), and
// the last states are the ones that say how it ended.
const visibleStates = 200;

const compact = (value: unknown): string => value === undefined ? '' : JSON.stringify(value);

const plans: { key: 'optimalPlan' | 'distractorPlan' | 'naiveAttempt'; label: string }[] = [
  { key: 'optimalPlan', label: 'Optimal plan' },
  { key: 'distractorPlan', label: 'Distractor plan' },
  { key: 'naiveAttempt', label: 'Naive attempt' }
];

function Predicate({ goal }: { goal: GoalPredicate }) {
  return <InlineCode>{goal.thing}.{goal.property} {goal.op} {compact(goal.value)}</InlineCode>;
}

// Goal satisfaction of one state: satisfied predicates over all predicates.
function Satisfaction({ holding, total }: { holding: number; total: number }) {
  return <Stack direction="horizontal" align="center" gap="condensed">
    <div className="sat-bar" role="img" aria-label={`${holding} of ${total} goal predicates hold`}>
      <div className={`sat-bar-fill${holding === total ? ' sat-bar-fill--full' : ''}`} style={{ width: `${total ? (holding / total) * 100 : 0}%` }} />
    </div>
    <Text className="mono" size="small">{holding}/{total}</Text>
  </Stack>;
}

// Memoised: a replay appends states and never changes one, so a long run only
// ever renders its new rows.
const StateRow = memo(function StateRow({ state, goal }: { state: ReplayState; goal: GoalPredicate[] }) {
  const step = state.step;
  // What the harness recorded, when it disagrees with what the replay got: the
  // run did not reproduce, which is worth seeing before anything else.
  const diverged = step !== undefined && (
    (step.status !== undefined && state.status !== undefined && step.status !== state.status) ||
    (step.output !== undefined && compact(step.output) !== compact(state.output)));

  return <tr>
    <td className="cell-shrink mono">S{state.index}</td>
    <td className="replay-wrap">
      {/* The input goes on a line of its own: a payload can be any length, and
          beside the call it would push the columns that matter off the table. */}
      {step
        ? <Stack gap="none" align="start">
            <InlineCode>{step.thing}.{step.action}</InlineCode>
            {!hasNoInput(step) && <pre className="replay-output replay-input"><HighlightedJson source={compact(step.input)} /></pre>}
          </Stack>
        : <Text className="muted">initial state</Text>}
    </td>
    <td className="cell-shrink">
      {step && <Label variant={state.ok ? 'success' : 'danger'}>{state.status ?? 'failed'}</Label>}
    </td>
    <td className="replay-output-cell">
      {state.output !== undefined && <pre className="replay-output"><HighlightedJson source={compact(state.output)} /></pre>}
      {diverged && <Stack gap="none" align="start">
        <Label variant="attention">differs from the file</Label>
        <Text size="small" className="muted mono replay-recorded">{[step?.status, compact(step?.output)].filter(Boolean).join(' ')}</Text>
      </Stack>}
    </td>
    <td className="replay-wrap">
      <Stack gap="none">
        {(state.index === 0 ? goal.map((_, index) => index) : state.changed).map(index =>
          <Text key={index} size="small" className={`mono ${state.readings[index].holds ? 'replay-holds' : 'muted'}`}>
            {goal[index].thing}.{goal[index].property} = {state.readings[index].error ?? compact(state.readings[index].actual)}
          </Text>)}
      </Stack>
    </td>
    {goal.length > 0 && <td className="cell-shrink"><Satisfaction holding={state.holding} total={goal.length} /></td>}
  </tr>;
});

const noGoal: GoalPredicate[] = [];

export function ReplayView({ onLabChanged }: { onLabChanged: () => void }) {
  const [current, setCurrent] = useState<string | undefined>();
  const [currentTasks, setCurrentTasks] = useState<Task[]>([]);
  const [taskId, setTaskId] = useState('');
  const [plan, setPlan] = useState<(typeof plans)[number]['key']>('optimalPlan');

  const [runs, setRuns] = useState<Run[]>([]);
  const [selected, setSelected] = useState(0);
  const [source, setSource] = useState('');
  // The tasks of the *run's* environment, which need not be the running one.
  const [runTasks, setRunTasks] = useState<Task[] | null>(null);

  const [states, setStates] = useState<ReplayState[]>([]);
  const [replaying, setReplaying] = useState(false);
  const [starting, setStarting] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [failure, setFailure] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const replay = useRef<AbortController | null>(null);

  const run: Run | undefined = runs[selected];

  async function loadCurrent(signal?: AbortSignal) {
    const { current: name } = await labEnvironments(signal);
    setCurrent(name);
    const tasks = name ? (await environmentTasks(name, signal)).tasks : [];
    setCurrentTasks(tasks);
    setTaskId(id => tasks.some(task => task.id === id) ? id : tasks[0]?.id ?? '');
  }

  useEffect(() => {
    const controller = new AbortController();
    void loadCurrent(controller.signal).catch(cause => {
      if (!controller.signal.aborted) setFailure(cause instanceof Error ? cause.message : 'Unable to reach WoT Lab.');
    });
    return () => { controller.abort(); replay.current?.abort(); };
  }, []);

  useEffect(() => {
    setRunTasks(null);
    if (!run?.task) return;
    const controller = new AbortController();
    void environmentTasks(run.environment, controller.signal)
      .then(result => setRunTasks(result.tasks))
      .catch(() => { if (!controller.signal.aborted) setRunTasks([]); });
    return () => controller.abort();
  }, [run?.environment, run?.task]);

  function show(loaded: Run[], label: string) {
    replay.current?.abort();
    setRuns(loaded); setSelected(0); setSource(label); setStates([]); setShowAll(false); setFailure('');
  }

  async function openFile(file: File | undefined) {
    if (!file) return;
    try {
      show(parseRuns(await file.text()), file.name);
    } catch (cause) {
      setRuns([]); setStates([]);
      setFailure(`${file.name}: ${cause instanceof Error ? cause.message : 'could not be read'}`);
    }
  }

  const selectedTask = currentTasks.find(task => task.id === taskId);
  const availablePlans = plans.filter(candidate => selectedTask?.[candidate.key] !== undefined);
  useEffect(() => {
    if (selectedTask && selectedTask[plan] === undefined) setPlan('optimalPlan');
  }, [selectedTask, plan]);

  const task = run?.task ? runTasks?.find(candidate => candidate.id === run.task) : undefined;
  const goal = (run?.task ? task?.goal : run?.goal) ?? noGoal;
  const initialState = run ? (run.task ? task?.initialState : run.initialState) ?? {} : {};
  const taskMissing = Boolean(run?.task) && runTasks !== null && !task;
  const wrongEnvironment = Boolean(run) && run.environment !== current;

  async function startRunEnvironment() {
    if (!run) return;
    setStarting(true); setFailure('');
    const problem = await replaceWithEnvironment(run.environment);
    setStarting(false);
    if (problem) { setFailure(problem); return; }
    onLabChanged();
    void loadCurrent().catch(() => undefined);
  }

  async function start() {
    if (!run) return;
    const controller = new AbortController();
    replay.current?.abort();
    replay.current = controller;
    setStates([]); setFailure(''); setReplaying(true);
    // Steps against a local lab answer in a few milliseconds, faster than the
    // table lays out, and a layout per step starves the requests themselves. So
    // states reach React a few times a second, not once per step.
    let pending: ReplayState[] = [];
    let timer = 0;
    const flush = () => {
      timer = 0;
      const batch = pending;
      pending = [];
      if (batch.length && !controller.signal.aborted) setStates(previous => [...previous, ...batch]);
    };
    try {
      await replayRun(run, { initialState, goal }, state => {
        pending.push(state);
        timer ||= window.setTimeout(flush, 200);
      }, controller.signal);
      window.clearTimeout(timer);
      flush();
    } catch (cause) {
      if (!controller.signal.aborted) setFailure(cause instanceof Error ? cause.message : 'The replay failed.');
    } finally {
      if (replay.current === controller) { replay.current = null; setReplaying(false); }
    }
  }

  const last = states[states.length - 1];
  const finished = !replaying && states.length === (run?.steps.length ?? 0) + 1;
  const failedSteps = states.filter(state => state.step && !state.ok).length;
  const hidden = showAll ? 0 : Math.max(0, states.length - visibleStates);
  // S0 stays: it is the floor every later state is read against.
  const rows = hidden ? [states[0], ...states.slice(hidden + 1)] : states;

  return <Stack gap="spacious">
    <Stack gap="condensed">
      <Text className="eyebrow eyebrow-accent" as="div">Benchmark</Text>
      <Heading as="h2"><Stack direction="horizontal" align="center" gap="condensed"><HistoryIcon size={28} />Replay a run</Stack></Heading>
      <Text className="muted">
        A run is the sequence of Action invocations an agent made at a task. Replaying it resets the environment,
        sets the task's initial state, makes every invocation again and shows how much of the goal holds in each state.
      </Text>
    </Stack>

    <Stack gap="normal">
      <Stack direction="horizontal" gap="normal" align="end" wrap="wrap">
        <input ref={fileInput} type="file" accept=".json,.jsonl,application/json" hidden
          onChange={event => { void openFile(event.target.files?.[0]); event.target.value = ''; }} />
        <Button leadingVisual={UploadIcon} onClick={() => fileInput.current?.click()}>Open a run file</Button>

        {/* A task's plan already is a run, so it replays without a file. */}
        {currentTasks.length > 0 && <>
          <Text className="muted">or</Text>
          <FormControl>
            <FormControl.Label>Task of {current}</FormControl.Label>
            <Select value={taskId} onChange={event => setTaskId(event.target.value)}>
              {currentTasks.map(candidate => <Select.Option key={candidate.id} value={candidate.id}>{candidate.id} · {candidate.level}</Select.Option>)}
            </Select>
          </FormControl>
          <FormControl>
            <FormControl.Label>Plan</FormControl.Label>
            <Select value={plan} onChange={event => setPlan(event.target.value as typeof plan)}>
              {availablePlans.map(candidate => <Select.Option key={candidate.key} value={candidate.key}>{candidate.label}</Select.Option>)}
            </Select>
          </FormControl>
          <Button disabled={!selectedTask} onClick={() => {
            if (!selectedTask) return;
            const label = plans.find(candidate => candidate.key === plan)?.label ?? plan;
            show([runFromPlan(selectedTask, selectedTask[plan] ?? [], label)], `${selectedTask.id} · ${label}`);
          }}>Load</Button>
        </>}
      </Stack>
      {failure && <Flash variant="danger">{failure}</Flash>}
    </Stack>

    {run && <Stack gap="normal">
      <Stack direction="horizontal" align="center" gap="condensed" wrap="wrap">
        <Heading as="h3" style={{ fontSize: 18 }}>{source}</Heading>
        {runs.length > 1 && <Select aria-label="Run" value={String(selected)}
          onChange={event => { replay.current?.abort(); setSelected(Number(event.target.value)); setStates([]); }}>
          {runs.map((candidate, index) => <Select.Option key={index} value={String(index)}>
            {`Run ${index + 1}: ${[candidate.task, candidate.agent].filter(Boolean).join(' · ') || candidate.environment}`}
          </Select.Option>)}
        </Select>}
      </Stack>

      <dl className="replay-facts">
        <dt>Environment</dt><dd><InlineCode>{run.environment}</InlineCode></dd>
        {run.task && <><dt>Task</dt><dd><InlineCode>{run.task}</InlineCode>{task && <Text className="muted"> · level {task.level}</Text>}</dd></>}
        {[run.agent, run.model].some(Boolean) && <><dt>Agent</dt><dd>{[run.agent, run.model].filter(Boolean).join(' · ')}</dd></>}
        {run.timestamp && <><dt>Recorded</dt><dd>{run.timestamp}</dd></>}
        <dt>Steps</dt><dd>{run.steps.length}</dd>
        {task && <><dt>Request</dt><dd>{task.request}</dd></>}
        {goal.length > 0 && <><dt>Goal</dt><dd><Stack gap="condensed" align="start">{goal.map((predicate, index) => <Predicate key={index} goal={predicate} />)}</Stack></dd></>}
        {task?.note && <><dt>Note</dt><dd>{task.note}</dd></>}
      </dl>

      {taskMissing && <Flash variant="danger">
        Environment <InlineCode>{run.environment}</InlineCode> has no task <InlineCode>{run.task}</InlineCode>, so the run has no initial state or goal to replay against.
      </Flash>}
      {!run.task && !goal.length && <Flash>This run names no task and carries no goal, so its steps are replayed without goal satisfaction.</Flash>}

      {wrongEnvironment
        ? <Flash variant="warning">
            <Stack direction="horizontal" align="center" justify="space-between" gap="normal" wrap="wrap">
              <Text>
                This run belongs to <InlineCode>{run.environment}</InlineCode>, but {current ? <><InlineCode>{current}</InlineCode> is running</> : 'no environment is running'}.
                Starting it takes everything that is running offline.
              </Text>
              <Button leadingVisual={PlayIcon} loading={starting} onClick={() => void startRunEnvironment()}>Start {run.environment}</Button>
            </Stack>
          </Flash>
        : <Stack direction="horizontal" align="center" gap="normal">
            <Button variant="primary" leadingVisual={PlayIcon} loading={replaying}
              disabled={taskMissing || (Boolean(run.task) && runTasks === null)} onClick={() => void start()}>
              {states.length ? 'Replay again' : 'Replay'}
            </Button>
            {replaying && <Button onClick={() => replay.current?.abort()}>Stop</Button>}
            {replaying && <Text className="muted" size="small">{Math.max(0, states.length - 1)} of {run.steps.length} steps</Text>}
          </Stack>}

      {states.length > 0 && <Stack gap="condensed">
        {finished && last && <Flash variant={goal.length ? (last.holding === goal.length ? 'success' : 'warning') : 'default'}>
          {goal.length
            ? last.holding === goal.length
              ? `Goal reached: ${goal.length === 1 ? 'its predicate holds' : `all ${goal.length} predicates hold`} after ${run.steps.length} step${run.steps.length === 1 ? '' : 's'}.`
              : `Goal not reached: ${last.holding} of ${goal.length} predicate${goal.length === 1 ? ' holds' : 's hold'} after ${run.steps.length} step${run.steps.length === 1 ? '' : 's'}.`
            : `Replayed ${run.steps.length} step${run.steps.length === 1 ? '' : 's'}.`}
          {failedSteps > 0 && ` ${failedSteps} step${failedSteps === 1 ? '' : 's'} failed.`}
        </Flash>}

        {hidden > 0 && <Stack direction="horizontal" align="center" gap="condensed">
          <Text size="small" className="muted">Showing the initial state and the last {visibleStates - 1} of {states.length} states.</Text>
          <Button size="small" variant="invisible" onClick={() => setShowAll(true)}>Show all</Button>
        </Stack>}

        <div className="table-scroll">
          <table className="aff-table aff-table--replay">
            <thead><tr>
              <th>State</th><th>Invocation</th><th>Status</th><th>Output</th>
              <th>{goal.length ? 'Goal properties changed' : ''}</th>
              {goal.length > 0 && <th>Satisfaction</th>}
            </tr></thead>
            <tbody>{rows.map(state => <StateRow key={state.index} state={state} goal={goal} />)}</tbody>
          </table>
        </div>
        {replaying && <Stack align="center" padding="condensed"><Spinner size="small" /></Stack>}
      </Stack>}
    </Stack>}
  </Stack>;
}
