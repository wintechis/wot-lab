#!/usr/bin/env python3
"""Replay a task file against a running lab and check every claim it makes.

A task file is a set of claims about an environment. Per task this asserts:

  a. every predicate names a Thing and a Property the served TD declares, with
     an operator that fits the Property's type (order on numbers, length and
     contains on arrays);
  b. reading is free of side effects: fetching every TD and every Property
     changes no Property value;
  c. every step of `optimalPlan` answers without error — and, where the output
     has a `success` field, with success true — and the final state satisfies
     the goal;
  d. no proper prefix of `optimalPlan` already satisfies the goal;
  e. L4: `distractorPlan` ends in a state that violates at least one predicate;
  f. L0/L5: the initial state satisfies the goal; L5 with a `naiveAttempt`: the
     attempt changes no Property value.

For a plan of two or three steps it also tries each step on its own from the
initial state: a single Action that already reaches the goal refutes the plan.

Start the lab first, then:

    bun src/main.ts --env mosaik &
    python3 tools/verify_tasks.py mosaik

Every task starts from a clean environment: `POST /_lab/reset`, then its
`initialState` injected through `POST /_lab/state`, one Thing per request.
"""

from __future__ import annotations

import argparse
import json
import os
import urllib.error
import urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Environments too large to snapshot whole; the side-effect check reads the
# Things the task names instead of all of them.
SCALE = {"ibm-building3", "ibm-building3-small"}

NUMERIC = {"number", "integer"}
ORDER_OPS = {"<", "<=", ">", ">="}
ARRAY_OPS = {"length", "contains"}


# -- HTTP -------------------------------------------------------------------


def request(url: str, body=..., method: str = "POST"):
    data = None if body is ... else json.dumps(body).encode()
    headers = {} if data is None else {"Content-Type": "application/json"}
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=30) as response:
        raw = response.read()
    return json.loads(raw) if raw else None


def get(url: str):
    return request(url, method="GET")


class Lab:
    def __init__(self, base: str):
        self.base = base
        self.tds: dict[str, dict] = {}

    def td(self, thing: str) -> dict:
        if thing not in self.tds:
            self.tds[thing] = get(f"{self.base}/{thing}")
        return self.tds[thing]

    def things(self) -> list[str]:
        return [t["id"] for t in get(f"{self.base}/_lab/things")["things"]]

    def properties(self, thing: str) -> dict:
        return get(f"{self.base}/{thing}/properties")

    def read(self, thing: str, prop: str):
        return get(f"{self.base}/{thing}/properties/{prop}")

    def invoke(self, step: dict):
        payload = step.get("input")
        return request(
            f"{self.base}/{step['thing']}/actions/{step['action']}",
            ... if payload == {} else payload,
        )

    def reset(self, task: dict) -> None:
        request(f"{self.base}/_lab/reset", {})
        for thing, values in (task.get("initialState") or {}).items():
            request(f"{self.base}/_lab/state", {"id": thing, "values": values})

    def snapshot(self, things: list[str]) -> dict:
        return {thing: self.properties(thing) for thing in things}


# -- predicates ---------------------------------------------------------------


def satisfied(actual, goal) -> bool:
    op, expected = goal["op"], goal["value"]
    if op == "=":
        return actual == expected
    if op == "!=":
        return actual != expected
    if op == "<":
        return actual < expected
    if op == "<=":
        return actual <= expected
    if op == ">":
        return actual > expected
    if op == ">=":
        return actual >= expected
    if op == "length":
        return len(actual) == expected
    if op == "contains":
        return expected in actual
    raise SystemExit(f"unknown goal operator '{op}'")


def failing(lab: Lab, task: dict) -> list[str]:
    """The predicates that do not hold now, described."""
    out = []
    for goal in task["goal"]:
        actual = lab.read(goal["thing"], goal["property"])
        if not satisfied(actual, goal):
            out.append(f"{goal['thing']}.{goal['property']}={actual!r} not {goal['op']} {goal['value']!r}")
    return out


def resolve(lab: Lab, task: dict) -> list[str]:
    """(a) Thing, Property and operator against the served TD."""
    problems = []
    for goal in task["goal"]:
        try:
            td = lab.td(goal["thing"])
        except urllib.error.HTTPError:
            problems.append(f"no Thing '{goal['thing']}'")
            continue
        schema = (td.get("properties") or {}).get(goal["property"])
        if schema is None:
            problems.append(f"{goal['thing']} declares no Property '{goal['property']}'")
            continue
        kind = schema.get("type")
        if goal["op"] in ORDER_OPS and kind not in NUMERIC:
            problems.append(f"{goal['thing']}.{goal['property']} is {kind}, not ordered ('{goal['op']}')")
        if goal["op"] in ARRAY_OPS and kind != "array":
            problems.append(f"{goal['thing']}.{goal['property']} is {kind}, not an array ('{goal['op']}')")
    return problems


def named(task: dict) -> list[str]:
    ids = [g["thing"] for g in task["goal"]]
    for key in ("optimalPlan", "distractorPlan", "naiveAttempt"):
        ids += [s["thing"] for s in task.get(key) or []]
    return sorted(set(ids))


# -- the run --------------------------------------------------------------


def run_plan(lab: Lab, task: dict, plan: list[dict], strict: bool) -> str | None:
    """Run `plan`; with `strict`, fail on an error, success false, or an early goal."""
    for index, step in enumerate(plan):
        try:
            output = lab.invoke(step)
        except urllib.error.HTTPError as error:
            if strict:
                return f"step {index} {step['thing']}.{step['action']} -> HTTP {error.code}"
            continue
        if strict and isinstance(output, dict) and output.get("success") is False:
            return f"step {index} {step['thing']}.{step['action']} answered success false"
        if strict and index < len(plan) - 1 and not failing(lab, task):
            return f"goal already holds after step {index + 1} of {len(plan)} (prefix)"
    return None


def verify(lab: Lab, task: dict, scope: list[str]) -> list[str]:
    """Every problem with one task; empty means it passed."""
    problems = resolve(lab, task)
    if problems:
        return problems
    plan = task.get("optimalPlan")
    if plan is None:
        return ["no optimalPlan"]

    lab.reset(task)

    # (b) reads have no side effects
    before = lab.snapshot(scope)
    for thing in scope:
        for prop in lab.td(thing).get("properties") or {}:
            lab.read(thing, prop)
    if lab.snapshot(scope) != before:
        problems.append("reading changed a Property value")

    initially_failing = failing(lab, task)

    if not plan:
        # (f) L0 / L5: the goal is the state as it stands
        if initially_failing:
            problems.append("empty plan but the goal does not hold initially: " + "; ".join(initially_failing))
        if task.get("level") == "L5" and task.get("naiveAttempt"):
            before = lab.snapshot(scope)
            run_plan(lab, task, task["naiveAttempt"], strict=False)
            if lab.snapshot(scope) != before:
                problems.append("naiveAttempt changed a Property value")
        if task.get("level") == "L5" and "note" not in task:
            problems.append("L5 without a note saying what makes the request unreachable")
        return problems

    if not initially_failing:
        problems.append("goal already holds before the plan runs")
        return problems

    # (c) + (d)
    error = run_plan(lab, task, plan, strict=True)
    if error:
        problems.append(error)
    else:
        left = failing(lab, task)
        if left:
            problems.append(f"after {len(plan)} steps: " + "; ".join(left))

    # cheap minimality: no single step of a short plan reaches the goal alone
    if 2 <= len(plan) <= 3 and task["environment"] not in SCALE:
        for step in plan:
            lab.reset(task)
            run_plan(lab, task, [step], strict=False)
            if not failing(lab, task):
                problems.append(f"{step['thing']}.{step['action']} alone reaches the goal; plan is not minimal")
                break

    # (e) the tempting wrong run really is wrong
    if task.get("level") == "L4":
        distractor = task.get("distractorPlan")
        if not distractor:
            problems.append("L4 without a distractorPlan")
        else:
            lab.reset(task)
            run_plan(lab, task, distractor, strict=False)
            if not failing(lab, task):
                problems.append("distractorPlan satisfies the goal")

    return problems


def run(base: str, env: str) -> int:
    lab = Lab(base)
    current = get(f"{base}/_lab/environments").get("current")
    if current != env:
        raise SystemExit(f"the lab at {base} is running '{current or 'no environment'}', not '{env}'")

    path = os.path.join(REPO, "src", "environments", env, "tasks.json")
    with open(path, encoding="utf-8") as handle:
        tasks = json.load(handle)
    everything = lab.things()

    bad = 0
    for task in tasks:
        scope = named(task) if env in SCALE else everything
        problems = verify(lab, task, scope)
        width = len(task.get("optimalPlan") or [])
        line = f"  {task['id']:6} {task.get('level', '-'):3} |G|={len(task['goal']):<2} l={width:<3}"
        if problems:
            bad += 1
            print(f"{line} FAIL  " + " | ".join(problems))
        else:
            print(f"{line} ok")

    request(f"{base}/_lab/reset", {})
    print(f"  {len(tasks) - bad}/{len(tasks)} passed")
    return bad


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("environment")
    parser.add_argument("--base", default="http://localhost:8081")
    args = parser.parse_args()
    print(f"{args.environment}:")
    if run(args.base, args.environment):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
