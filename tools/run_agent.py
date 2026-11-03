#!/usr/bin/env python3
"""Run an agent against one WoT-Lab environment's tasks and score every attempt.

An agent gets a task's natural-language request and the running environment in
the task's initial state, never its goal. The attempt is the sequence of Action
invocations it makes; fetching Thing Descriptions and reading Properties are
free. When the agent stops, the final state is checked against the goal:

  success     every goal predicate holds
  goal        the fraction of goal predicates that hold (partial credit)
  efficiency  optimal plan length / invocations, for a success whose optimal
              plan is not empty (DL0 and DL5 tasks are won by invoking nothing)

Start the lab first, then:

    bun src/main.ts --env smart-home &
    python3 tools/run_agent.py smart-home --agent oracle      # scorer sanity check
    python3 tools/run_agent.py smart-home --agent noop        # the do-nothing floor
    python3 tools/run_agent.py smart-home --agent claude --attempts 3

One JSON record per attempt goes to `results/` (see results/README.md), and a
summary per difficulty level is printed at the end. To evaluate your own agent,
implement `Agent` below (one `attempt` method) and register it in `AGENTS`.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Callable, Protocol

from lab import REPO, Lab, failing, load_tasks, wait_for_environment

LEVELS = ["DL0", "DL1", "DL2", "DL3", "DL4", "DL5", "S"]


# -- what an agent sees ---------------------------------------------------------


@dataclass
class Task:
    """What an agent is told about a task: its id and request, not its goal."""

    id: str
    request: str


class WoTError(Exception):
    """A request the environment refused (unknown Thing, HTTP error, ...)."""


def describe(error: urllib.error.HTTPError) -> str:
    with error:
        body = error.read().decode(errors="replace").strip()
    return f"HTTP {error.code}" + (f": {body}" if body else "")


class Things:
    """The running environment, as an agent may use it.

    Only Things listed in the WoT directory (`GET /`) can be reached, so the
    lab's own `/_lab` routes, which hold the goals, stay out of reach. Every
    `invoke` call is appended to `invocations`: that log is the attempt.
    """

    def __init__(self, lab: Lab):
        self.lab = lab
        self.invocations: list[dict] = []
        self._directory: list[dict] | None = None

    def list(self, query: str | None = None) -> list[dict]:
        """The running Things (id and title), optionally those whose id or title contains `query`."""
        if self._directory is None:
            self._directory = [{"id": t["id"], "title": t.get("title")} for t in self.lab.directory()]
        if not query:
            return self._directory
        q = query.lower()
        return [t for t in self._directory if q in t["id"].lower() or q in (t["title"] or "").lower()]

    def td(self, thing: str) -> dict:
        self._check(thing)
        return self._http(lambda: self.lab.td(thing))

    def read(self, thing: str, prop: str):
        self._check(thing)
        return self._http(lambda: self.lab.read(thing, _segment(prop)))

    def invoke(self, thing: str, action: str, input=None):
        entry: dict = {"thing": thing, "action": action, "input": input}
        self.invocations.append(entry)
        try:
            self._check(thing)
            output = self._http(lambda: self.lab.invoke(thing, _segment(action), input))
        except WoTError as error:
            entry["error"] = str(error)
            raise
        entry["output"] = output
        return output

    def _check(self, thing: str) -> None:
        if not any(t["id"] == thing for t in self.list()):
            raise WoTError(f"no Thing '{thing}'; list_things shows the running Things")

    @staticmethod
    def _http(call: Callable):
        try:
            return call()
        except urllib.error.HTTPError as error:
            raise WoTError(describe(error)) from None


def _segment(name: str) -> str:
    return urllib.parse.quote(name, safe="")


# -- agents -------------------------------------------------------------------


@dataclass
class Report:
    """How an attempt ended, in the agent's words. The score comes from the lab, not from here."""

    stop: str = "finish"  # finish | end_turn | step_limit | refusal | max_tokens | error
    note: str | None = None
    error: str | None = None
    steps: int = 0  # model turns, for an LM agent
    usage: dict | None = None


class Agent(Protocol):
    name: str
    model: str | None

    def attempt(self, task: Task, things: Things) -> Report: ...


class NoopAgent:
    """Invokes nothing: the floor every agent should beat, and a pass on DL0/DL5."""

    name, model = "noop", None

    def attempt(self, task: Task, things: Things) -> Report:
        return Report(note="did nothing")


class OracleAgent:
    """Replays each task's optimal plan. It reads the answer key, so it only checks the scorer."""

    name, model = "oracle", None

    def __init__(self, tasks: list[dict]):
        self.plans = {t["id"]: t.get("optimalPlan") or [] for t in tasks}

    def attempt(self, task: Task, things: Things) -> Report:
        for step in self.plans[task.id]:
            things.invoke(step["thing"], step["action"], step.get("input"))
        return Report(note="replayed the optimal plan")


SYSTEM = """You operate devices and services exposed as W3C Web of Things (WoT) Things. \
A user gives you a request; carry it out by invoking the Things' Actions.

- Find the Things with list_things. A Thing's Thing Description (get_thing_description) \
says what it offers: its Properties, its Actions with their input schemas, and what each one does.
- Fetching Thing Descriptions and reading Properties are free and change nothing. \
Every Action invocation counts: invoke only what the request needs, and check the state \
rather than retrying blindly.
- An Action can fail, or answer with a result saying it did not succeed; read its output.
- If the request is already satisfied, or cannot be carried out with the Actions available, \
change nothing and call finish with a note saying why.
- When the request is done, call finish."""

TOOLS = [
    {
        "name": "list_things",
        "description": "List the running Things: their ids and titles.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Only Things whose id or title contains this text (case-insensitive).",
                }
            },
        },
    },
    {
        "name": "get_thing_description",
        "description": "Fetch a Thing's Thing Description (TD): its Properties, Actions and Events.",
        "input_schema": {
            "type": "object",
            "properties": {"thing": {"type": "string", "description": "The Thing's id."}},
            "required": ["thing"],
        },
    },
    {
        "name": "read_property",
        "description": "Read the current value of one of a Thing's Properties. Free and side-effect free.",
        "input_schema": {
            "type": "object",
            "properties": {
                "thing": {"type": "string", "description": "The Thing's id."},
                "property": {"type": "string", "description": "The Property's name in the TD."},
            },
            "required": ["thing", "property"],
        },
    },
    {
        "name": "invoke_action",
        "description": "Invoke one of a Thing's Actions and return its output. Each invocation counts.",
        "input_schema": {
            "type": "object",
            "properties": {
                "thing": {"type": "string", "description": "The Thing's id."},
                "action": {"type": "string", "description": "The Action's name in the TD."},
                "input": {
                    "description": "The Action's input, shaped as the TD's input schema says. "
                    "Omit it for an Action without input."
                },
            },
            "required": ["thing", "action"],
        },
    },
    {
        "name": "finish",
        "description": "End the attempt. Call it once the request is done, or when it is already "
        "satisfied or cannot be carried out.",
        "input_schema": {
            "type": "object",
            "properties": {
                "note": {
                    "type": "string",
                    "description": "Optional: what you did, or why the request cannot be carried out.",
                }
            },
        },
    },
]

DEFAULT_MODEL = "claude-fable-5-1"
USAGE_FIELDS = ("input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")


class ClaudeAgent:
    """A tool-use loop over the generic WoT tools above, on the Anthropic Messages API.

    `client` is anything with `messages.create(...)` shaped like `anthropic.Anthropic()`;
    tests pass a scripted fake.
    """

    name = "claude"

    def __init__(self, model: str = DEFAULT_MODEL, max_steps: int = 100, effort: str = "high", client=None):
        if client is None:
            try:
                import anthropic  # only this agent needs the SDK
            except ImportError:
                raise SystemExit("the claude agent needs the Anthropic SDK: pip install -r tools/requirements.txt") from None
            client = anthropic.Anthropic(max_retries=5)  # key from ANTHROPIC_API_KEY or `ant auth login`
        self.client, self.model, self.max_steps, self.effort = client, model, max_steps, effort

    def attempt(self, task: Task, things: Things) -> Report:
        messages: list[dict] = [{"role": "user", "content": task.request}]
        usage = dict.fromkeys(USAGE_FIELDS, 0)
        report = Report(usage=usage)
        for step in range(1, self.max_steps + 1):
            report.steps = step
            try:
                response = self.client.messages.create(
                    model=self.model,
                    max_tokens=16000,
                    system=SYSTEM,
                    tools=TOOLS,
                    messages=messages,
                    output_config={"effort": self.effort},
                    cache_control={"type": "ephemeral"},  # the history is resent every turn
                )
            except Exception as error:  # the SDK has already retried what is retryable
                report.stop, report.error = "error", f"{type(error).__name__}: {error}"
                return report
            for key in USAGE_FIELDS:
                usage[key] += getattr(response.usage, key, None) or 0
            # Append the whole content, thinking blocks included, unchanged.
            messages.append({"role": "assistant", "content": response.content})

            if response.stop_reason in ("refusal", "max_tokens"):
                report.stop = response.stop_reason
                return report
            calls = [block for block in response.content if block.type == "tool_use"]
            if not calls:
                report.stop = "end_turn"
                report.note = "".join(b.text for b in response.content if b.type == "text") or None
                return report

            results, finished = [], False
            for call in calls:
                if call.name == "finish":
                    finished, report.note = True, (call.input or {}).get("note")
                    content, is_error = "Finished.", False
                else:
                    content, is_error = self.dispatch(things, call.name, call.input or {})
                results.append(
                    {"type": "tool_result", "tool_use_id": call.id, "content": content, "is_error": is_error}
                )
            if finished:
                report.stop = "finish"
                return report
            messages.append({"role": "user", "content": results})
        report.stop = "step_limit"
        return report

    @staticmethod
    def dispatch(things: Things, name: str, args: dict) -> tuple[str, bool]:
        """Run one tool call; the result text and whether it is an error."""
        try:
            if name == "list_things":
                value = things.list(args.get("query"))
            elif name == "get_thing_description":
                value = things.td(args["thing"])
            elif name == "read_property":
                value = things.read(args["thing"], args["property"])
            elif name == "invoke_action":
                value = things.invoke(args["thing"], args["action"], args.get("input"))
                if value is None:
                    return "The Action completed with no output.", False
            else:
                return f"unknown tool '{name}'", True
        except KeyError as missing:
            return f"missing argument {missing}", True
        except WoTError as error:
            return str(error), True
        return json.dumps(value), False


# -- scoring ------------------------------------------------------------------


def score(lab: Lab, task: dict, things: Things) -> dict:
    """Score the final state of an attempt against the task's goal."""
    left = failing(lab, task)
    goal = len(task["goal"])
    optimal = len(task.get("optimalPlan") or [])
    invocations = len(things.invocations)
    success = not left
    return {
        "success": success,
        "goal_fraction": (goal - len(left)) / goal if goal else 1.0,
        "invocations": invocations,
        "optimal_length": optimal,
        "efficiency": optimal / invocations if success and optimal and invocations else None,
        "failing": left,
    }


def run_attempt(lab: Lab, agent: Agent, task: dict, index: int) -> dict:
    lab.reset(task)
    things = Things(lab)
    start = time.monotonic()
    try:
        report = agent.attempt(Task(task["id"], task["request"]), things)
    except Exception as error:  # a broken agent fails its attempt, not the run
        report = Report(stop="error", error=f"{type(error).__name__}: {error}")
    seconds = time.monotonic() - start
    return {
        "task": task["id"],
        "environment": task["environment"],
        "level": task.get("level"),
        "agent": agent.name,
        "model": agent.model,
        "attempt": index,
        **score(lab, task, things),
        "stop": report.stop,
        "note": report.note,
        "error": report.error,
        "steps": report.steps,
        "log": things.invocations,
        "seconds": round(seconds, 3),
        "usage": report.usage,
    }


def mean(values: list) -> float | None:
    return sum(values) / len(values) if values else None


def summarize(records: list[dict]) -> list[dict]:
    """One row per level present, then the overall row."""
    groups = [(level, [r for r in records if r["level"] == level]) for level in LEVELS]
    groups = [g for g in groups if g[1]] + [("all", records)]
    rows = []
    for name, rs in groups:
        by_task: dict[str, list[bool]] = {}
        for r in rs:
            by_task.setdefault(r["task"], []).append(r["success"])
        rows.append(
            {
                "level": name,
                "tasks": len(by_task),
                "attempts": len(rs),
                "success": mean([r["success"] for r in rs]),
                "pass^k": mean([all(s) for s in by_task.values()]),
                "efficiency": mean([r["efficiency"] for r in rs if r["efficiency"] is not None]),
                "goal": mean([r["goal_fraction"] for r in rs]),
                "invocations": mean([r["invocations"] for r in rs]),
            }
        )
    return rows


def cell(value) -> str:
    if value is None:
        return "-"
    return f"{value:.2f}" if isinstance(value, float) else str(value)


def print_summary(rows: list[dict], attempts: int) -> None:
    columns = ["level", "tasks", "attempts", "success"] + (["pass^k"] if attempts >= 2 else [])
    columns += ["efficiency", "goal", "invocations"]
    table = [[c if c != "pass^k" else f"pass^{attempts}" for c in columns]]
    table += [[cell(row[c]) for c in columns] for row in rows]
    widths = [max(len(line[i]) for line in table) for i in range(len(columns))]
    for line in table:
        print("  " + "  ".join(text.rjust(width) for text, width in zip(line, widths)))


# -- the run ------------------------------------------------------------------


# --agent name -> how to build it from the command line and the tasks. Add yours here.
AGENTS: dict[str, Callable[[argparse.Namespace, list[dict]], Agent]] = {
    "claude": lambda args, tasks: ClaudeAgent(model=args.model, max_steps=args.max_steps, effort=args.effort),
    "noop": lambda args, tasks: NoopAgent(),
    "oracle": lambda args, tasks: OracleAgent(tasks),
}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("environment")
    parser.add_argument("--agent", choices=sorted(AGENTS), default="claude")
    parser.add_argument("--tasks", help="comma-separated task ids (default: all)")
    parser.add_argument("--attempts", type=int, default=1, help="attempts per task (pass^k needs 2 or more)")
    parser.add_argument("--model", default=DEFAULT_MODEL, help=f"Claude model (default {DEFAULT_MODEL})")
    parser.add_argument("--effort", default="high", choices=["low", "medium", "high", "xhigh", "max"])
    parser.add_argument("--max-steps", type=int, default=100, help="model turns per attempt (default 100)")
    parser.add_argument("--base", default="http://localhost:8081")
    parser.add_argument("--out", help="JSONL file to write (default: results/<env>-<agent>-<time>.jsonl)")
    args = parser.parse_args()

    tasks = load_tasks(args.environment)
    if args.tasks:
        wanted = args.tasks.split(",")
        unknown = set(wanted) - {t["id"] for t in tasks}
        if unknown:
            raise SystemExit(f"no such task in {args.environment}: {', '.join(sorted(unknown))}")
        tasks = [t for t in tasks if t["id"] in wanted]

    agent = AGENTS[args.agent](args, tasks)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = args.out or os.path.join(REPO, "results", f"{args.environment}-{args.agent}-{stamp}.jsonl")
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)

    lab = Lab(args.base)
    wait_for_environment(args.base, args.environment)
    records = []
    print(f"{args.environment}: agent {agent.name}" + (f" ({agent.model})" if agent.model else ""))
    try:
        with open(out, "w", encoding="utf-8") as handle:
            for task in tasks:
                for index in range(args.attempts):
                    record = run_attempt(lab, agent, task, index)
                    records.append(record)
                    handle.write(json.dumps(record) + "\n")
                    handle.flush()
                    efficiency = "-" if record["efficiency"] is None else f"{record['efficiency']:.2f}"
                    print(
                        f"  {task['id']:6} {task.get('level', '-'):3} #{index} "
                        f"{'ok  ' if record['success'] else 'FAIL'} goal={record['goal_fraction']:.2f} "
                        f"inv={record['invocations']:<3} l={record['optimal_length']:<3} eff={efficiency} "
                        f"[{record['stop']}]" + (f" {record['error']}" if record["error"] else "")
                    )
    finally:
        lab.reset()
    print()
    print_summary(summarize(records), args.attempts)
    print(f"  records: {out}")
    sys.stdout.flush()


if __name__ == "__main__":
    main()
