# tools/

## `tee2wotlab.py`

Converts a benchmark environment published by the [tee-wip][tee] paper
repository into wot-lab Thing Models and an environment manifest. It is how
`ibm-building3`, `ibm-building3-small` and `mosaik` in `src/environments/` were
produced, and it is checked in so they can be produced again when the dumps
change.

[tee]: https://github.com/derwehr/tee-wip

```sh
SRC=/path/to/tee-wip/environments

python3 tools/tee2wotlab.py "$SRC/mosaik" \
  --prefix mosaik --name mosaik --per-instance workstation \
  --description "..."

python3 tools/tee2wotlab.py "$SRC/ibm-building3" \
  --prefix b3 --name ibm-building3-small \
  --only Room_18-,Room_SOR42_G_15-,B3_42_1F_Z1_G10 --description "..."

python3 tools/tee2wotlab.py "$SRC/ibm-building3" \
  --prefix b3 --name ibm-building3 --description "..."
```

Run a subset before the full environment when both share a prefix: the models
are written by the last run, and the full population gives the better defaults.

### What it changes

The dumps carry `{{id}}`-templated Thing Models plus one `state.json` keyed by
instance; wot-lab splits that the other way, into a model directory per type and
a manifest that pins instances. On top of that split:

| In the dump | Here | Why |
| --- | --- | --- |
| `wotlab:effect` + `wotlab:bindings` | one `vre:effects` string, bindings as `const x = <id>;` | VRE's own binding form |
| `./Foo.td.json` | the instance id | `resolveThing` matches an alias, an id or a URI's last segment — not a file name |
| `carrying.xpos' = xpos'` | `carrying.xpos' = (xpos - 1)` | a primed right-hand side is rejected; under flat snapshot semantics it means the sibling's right-hand side |
| `"type": ["string", "boolean"]` | `oneOf` | a Thing Description's `type` is one string, and node-wot rejects the Thing otherwise |
| `{"level": 125}` in a reference plan | `125` | the Action's input is a scalar; VRE reads it under the schema's `title` |
| `brick:isPointOf` on the instance | the manifest's per-instance `td` | describes the instance, not the type |
| `{{id}}` forms, `tm:ThingModel` | dropped | node-wot generates forms; an instance is not a model |

Ids are slugified exactly as `normalizeThingId` does, since that spelling is the
state key, the URL and the Thing Description's `id` at once. Two source ids that
slugify alike are suffixed and the mapping is printed — in IBM Building 3 that
is the seven `Room_CoffeeDesk` / `Room_Coffeedesk` pairs.

An instance whose Actions differ from its model's (MOSAIK's workstations, one
produce Action per recipe) cannot share a model: effects are compiled from the
model's Thing Description at load. `--per-instance <model>` gives each such
instance its own model, built from the expanded Thing Description in `tds/`.

`rooms.json` and `tasks.json` are reference data about the environment rather
than about any Thing. They are carried into `src/environments/<name>/` with
their ids rewritten. Nothing in the lab loads them — `listEnvironments` reads
files, so the directory is inert.

## `envfmt.py`

The house layout for an environment manifest: one line per Thing carrying its
model, id and title, then a line each for `state`, `links` and `td`. Run it to
reformat every manifest in place; `tee2wotlab.py` imports `dumps` so a generated
manifest and a hand-written one look the same. It refuses a Thing with a field
outside `model`/`id`/`title`/`state`/`links`/`td`, and re-parses its own output
before writing, so formatting can never change a manifest's content.

```sh
python3 tools/envfmt.py
```

## `make_tasks.py` and `verify_tasks.py`

`make_tasks.py` writes `src/environments/<env>/tasks.json` for all seven
environments: the four service domains (ec-*, sh-*, sc-*, sm-*, ported from the
paper repository's planning notes and corrected against the environments as
they are), the smart office (b1–b11) and MOSAIK (s1–s6). What depends on the
environment is derived rather than transcribed:

- ids and URLs are the ones wot-lab serves (`Room_SOR42_G_15-colorlamp` →
  `room-sor42-g-15-colorlamp`; a property resource → `/<id>/properties/<name>`);
- every goal and every plan step is checked against the manifest and the Thing
  Models — an unknown Thing, Property or Action fails the run;
- MOSAIK's plans are computed by a simulator of the shopfloor (`Shopfloor`),
  because the smartphone chain is 618 invocations. Each leg is a shortest path;
  the order in which inputs are gathered is greedy, not proven optimal.
- the subset environment gets the tasks whose Things it actually holds.

```sh
python3 tools/make_tasks.py [--base http://localhost:8081]
```

A record is `id, environment, level, initialState, request, [note], goal,
optimalPlan`, plus `distractorPlan` on an L4 task (the tempting wrong run) and
`naiveAttempt` on an L5 task where the environment rejects the obvious attempt
outright. Predicates compare one Property with a constant using `=`, `!=`, `<`,
`<=`, `>`, `>=`, `length` or `contains`. Levels: L0 the goal already holds; L1
one Action, goal on that Thing; L2 several Actions, goal on the Things acted on;
L3 the goal spans Things one effect couples; L4 several runs reach the requested
state but all but one violate another predicate; L5 unreachable, goal = the
untouched state, plan empty; S the smart office.

`verify_tasks.py` replays a file against a running lab and checks every claim
a record makes: predicates resolve in the served TD with an operator that fits
the Property's type; reading every TD and Property changes nothing; every plan
step answers without error (and `success: true` where the output has it) and
the goal holds at the end; no proper prefix of the plan already reaches it; an
L4 distractor ends in violation; an L0/L5 goal holds initially and an L5
`naiveAttempt` changes nothing; and for a two- or three-step plan, no single
step reaches the goal alone. A task file that passes is a claim the environment
backs.

```sh
bun src/main.ts --env mosaik &
python3 tools/verify_tasks.py mosaik
```

## Run files (`run.schema.json`)

A **run** is the sequence of Action invocations an agent made at a task. The
dashboard's *Replay a run* page opens a run file, resets the environment, sets
the task's initial state, makes every invocation again and shows the goal
satisfaction (satisfied predicates / all predicates) of each state, S0 included.

```json
{ "environment": "smart-home",
  "task": "sh-5",
  "agent": "free text, optional",
  "steps": [
    { "thing": "washer", "action": "stopAppliance", "input": {} },
    { "thing": "dryer", "action": "startAppliance", "input": { "cycle": "normal" } } ] }
```

- A step is shaped like an `optimalPlan` entry, so a plan already is a run; the
  page also loads a task's `optimalPlan`, `distractorPlan` or `naiveAttempt`
  directly. Only Action invocations belong to a run: an entry with
  `"op": "read"` is skipped.
- Things are named by instance id, never by URL, so a file is valid on any host.
- `task` names the record that supplies `initialState` and `goal`; a run does
  not copy them. Without `task`, inline `initialState` and `goal` are used, and
  without a goal the steps are replayed unscored.
- A harness may record per-step `status` and `output`. They are not replayed;
  a step whose replay differs from them is flagged.
- One run per file, a JSON array of runs, or JSONL.
- A failing step does not stop a replay — an agent's run may hold failures.
