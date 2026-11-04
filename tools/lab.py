"""A small HTTP client for a running WoT-Lab, shared by the tools in this folder.

`Lab` resets an environment to a task's initial state, fetches Thing
Descriptions, reads Properties and invokes Actions; `failing` checks a task's
goal predicates against the live state. Standard library only.
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# How long to wait for `--env` to finish bringing its Things online.
STARTUP_SECONDS = 120


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

    def directory(self) -> list[dict]:
        """The running Things as a WoT consumer sees them: `GET /` as JSON (id, title, ...)."""
        req = urllib.request.Request(f"{self.base}/", headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=30) as response:
            return json.loads(response.read())["things"]

    def properties(self, thing: str) -> dict:
        return get(f"{self.base}/{thing}/properties")

    def read(self, thing: str, prop: str):
        return get(f"{self.base}/{thing}/properties/{prop}")

    def invoke(self, thing: str, action: str, payload=None):
        """Invoke an Action; no input (None or {}) sends no body."""
        return request(
            f"{self.base}/{thing}/actions/{action}",
            ... if payload is None or payload == {} else payload,
        )

    def reset(self, task: dict | None = None) -> None:
        """Reset every Thing, then inject the task's `initialState`, one Thing per request."""
        request(f"{self.base}/_lab/reset", {})
        for thing, values in ((task or {}).get("initialState") or {}).items():
            request(f"{self.base}/_lab/state", {"id": thing, "values": values})

    def snapshot(self, things: list[str]) -> dict:
        return {thing: self.properties(thing) for thing in things}


def wait_for_environment(base: str, env: str) -> None:
    """Block until the lab at `base` reports `env` as its current environment."""
    # The server answers before `--env` has finished; until then `current` is unset.
    deadline = time.monotonic() + STARTUP_SECONDS
    while True:
        try:
            current = get(f"{base}/_lab/environments").get("current")
        except (urllib.error.URLError, ConnectionError):
            current = None
        if current is not None or time.monotonic() > deadline:
            break
        time.sleep(0.5)
    if current != env:
        raise SystemExit(f"the lab at {base} is running '{current or 'no environment'}', not '{env}'")


def load_tasks(env: str) -> list[dict]:
    path = os.path.join(REPO, "src", "environments", env, "tasks.json")
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


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
