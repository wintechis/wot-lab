# Results

`tools/run_agent.py` writes one file per run here, `<env>-<agent>-<UTC time>.jsonl`
(or wherever `--out` points), with one JSON record per attempt:

| Field | Meaning |
| --- | --- |
| `task`, `environment`, `level` | The task attempted and its difficulty level (DL0-DL5, S). |
| `agent`, `model`, `attempt` | Who attempted it (`model` is null for `noop`/`oracle`), and the 0-based attempt index. |
| `success` | Whether the final state satisfies every goal predicate. |
| `goal_fraction` | The fraction of goal predicates the final state satisfies (partial credit). |
| `invocations` | Number of Action invocations: the length of the attempt. Property reads and TD fetches are free and not counted. |
| `optimal_length` | Length of the task's optimal plan; 0 for DL0 (already satisfied) and DL5 (infeasible). |
| `efficiency` | `optimal_length / invocations` for a successful attempt with `optimal_length > 0`, else null. |
| `failing` | The goal predicates that do not hold at the end, as `thing.property=actual not op expected`. |
| `log` | The attempt: every invocation in order, `{thing, action, input, output}` or `{..., error}`. Failed invocations count. |
| `stop` | How the agent stopped: `finish`, `end_turn` (stopped without calling finish), `step_limit`, `refusal`, `max_tokens` or `error`. |
| `note`, `error` | The agent's closing note (e.g. why a request is unreachable), and an error message if the attempt broke. |
| `steps` | Model turns the agent took (0 for agents without a model). |
| `seconds` | Wall time of the attempt, excluding reset and scoring. |
| `usage` | Token usage summed over the attempt (`input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`), when the agent reports it. |

The summary `run_agent.py` prints is computed from these records: per level and
overall, the success rate over attempts, mean efficiency over the attempts that
define it, mean goal fraction, mean invocations, and with two or more attempts
pass^k, the fraction of tasks all of whose k attempts succeeded.

Records hold no credentials, but the `note` and `log` fields carry model output;
look before you publish a run.
