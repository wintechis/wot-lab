"""Offline tests for tools/run_agent.py: no lab, no network, no API key.

The Claude agent's loop runs against a scripted fake of the Messages API and
an in-memory lab, so tool dispatch, the invocation log and the score are all
exercised without spending anything.

    python3 tools/test_run_agent.py
"""

from __future__ import annotations

import io
import json
import os
import sys
import unittest
import urllib.error
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from run_agent import ClaudeAgent, NoopAgent, OracleAgent, run_attempt, summarize  # noqa: E402

TASK = {
    "id": "t-1",
    "environment": "fake",
    "level": "DL1",
    "request": "Turn on the reading lamp.",
    "initialState": {},
    "goal": [{"thing": "lamp", "property": "on", "op": "=", "value": True}],
    "optimalPlan": [{"thing": "lamp", "action": "switchOn"}],
}


class FakeLab:
    """One lamp with a `switchOn` Action, in memory."""

    def __init__(self):
        self.state = {"on": False}

    def reset(self, task=None):
        self.state = {"on": False}

    def directory(self):
        return [{"id": "lamp", "title": "Reading Lamp", "href": "http://fake/lamp"}]

    def td(self, thing):
        return {"title": "Reading Lamp", "properties": {"on": {"type": "boolean"}}, "actions": {"switchOn": {}}}

    def read(self, thing, prop):
        if prop not in self.state:
            raise http_error(404)
        return self.state[prop]

    def invoke(self, thing, action, payload=None):
        if action != "switchOn":
            raise http_error(404, b'{"error":"no such action"}')
        self.state["on"] = True
        return None


def http_error(code, body=b""):
    return urllib.error.HTTPError("http://fake", code, "error", {}, io.BytesIO(body))


def tool_use(id, name, **input):
    return SimpleNamespace(type="tool_use", id=id, name=name, input=input)


def text(value):
    return SimpleNamespace(type="text", text=value)


def response(*content, stop="tool_use"):
    usage = SimpleNamespace(input_tokens=100, output_tokens=10, cache_read_input_tokens=50)
    return SimpleNamespace(content=list(content), stop_reason=stop, usage=usage)


class ScriptedClient:
    """Stands in for anthropic.Anthropic(): returns the scripted responses in order."""

    def __init__(self, *responses):
        self.responses = list(responses)
        self.calls: list[dict] = []
        self.messages = self

    def create(self, **kwargs):
        self.calls.append({**kwargs, "messages": list(kwargs["messages"])})
        return self.responses.pop(0)


def results_of(call):
    """The tool_result blocks the agent sent in a request, by tool_use id."""
    return {r["tool_use_id"]: r for r in call["messages"][-1]["content"]}


class ClaudeLoop(unittest.TestCase):
    def test_tool_loop_dispatch_and_score(self):
        client = ScriptedClient(
            response(tool_use("a", "list_things"), tool_use("b", "get_thing_description", thing="lamp")),
            response(
                tool_use("c", "read_property", thing="lamp", property="on"),
                tool_use("d", "invoke_action", thing="lamp", action="explode"),
                tool_use("e", "get_thing_description", thing="_lab/environments/fake/tasks"),
            ),
            response(tool_use("f", "invoke_action", thing="lamp", action="switchOn", input={})),
            response(text("Done."), tool_use("g", "finish", note="lamp is on")),
        )
        agent = ClaudeAgent(model="test-model", client=client)
        record = run_attempt(FakeLab(), agent, TASK, 0)

        # the request went in, the goal did not
        first = client.calls[0]
        self.assertEqual(first["messages"], [{"role": "user", "content": TASK["request"]}])
        self.assertNotIn("goal", json.dumps(first["messages"]) + first["system"])
        self.assertEqual(first["model"], "test-model")
        self.assertEqual(
            [t["name"] for t in first["tools"]],
            ["list_things", "get_thing_description", "read_property", "invoke_action", "finish"],
        )

        # every tool call was answered, in one user turn, errors flagged
        turn1 = results_of(client.calls[1])
        self.assertEqual(json.loads(turn1["a"]["content"]), [{"id": "lamp", "title": "Reading Lamp"}])
        self.assertIn("switchOn", turn1["b"]["content"])
        turn2 = results_of(client.calls[2])
        self.assertEqual((turn2["c"]["content"], turn2["c"]["is_error"]), ("false", False))
        self.assertTrue(turn2["d"]["is_error"])
        self.assertIn("HTTP 404", turn2["d"]["content"])
        self.assertTrue(turn2["e"]["is_error"])  # the lab's own routes are out of reach
        turn3 = results_of(client.calls[3])
        self.assertFalse(turn3["f"]["is_error"])

        # only Action invocations make up the attempt; the failed one counts too
        self.assertEqual([(s["action"], "error" in s) for s in record["log"]], [("explode", True), ("switchOn", False)])
        self.assertEqual(record["invocations"], 2)
        self.assertTrue(record["success"])
        self.assertEqual(record["goal_fraction"], 1.0)
        self.assertEqual(record["efficiency"], 0.5)
        self.assertEqual((record["stop"], record["note"], record["steps"]), ("finish", "lamp is on", 4))
        self.assertEqual(record["usage"]["input_tokens"], 400)
        self.assertEqual(record["usage"]["cache_read_input_tokens"], 200)

    def test_step_limit(self):
        client = ScriptedClient(*[response(tool_use(str(i), "list_things")) for i in range(3)])
        record = run_attempt(FakeLab(), ClaudeAgent(model="m", max_steps=3, client=client), TASK, 0)
        self.assertEqual((record["stop"], record["steps"], record["success"]), ("step_limit", 3, False))
        self.assertEqual(record["goal_fraction"], 0.0)

    def test_end_turn_without_finish(self):
        client = ScriptedClient(response(text("I cannot do that."), stop="end_turn"))
        record = run_attempt(FakeLab(), ClaudeAgent(model="m", client=client), TASK, 0)
        self.assertEqual((record["stop"], record["note"], record["invocations"]), ("end_turn", "I cannot do that.", 0))

    def test_api_error_fails_the_attempt_not_the_run(self):
        class Broken:
            messages = SimpleNamespace(create=lambda **_: (_ for _ in ()).throw(RuntimeError("boom")))

        record = run_attempt(FakeLab(), ClaudeAgent(model="m", client=Broken()), TASK, 0)
        self.assertEqual(record["stop"], "error")
        self.assertIn("boom", record["error"])


class Baselines(unittest.TestCase):
    def test_oracle_and_noop(self):
        oracle = run_attempt(FakeLab(), OracleAgent([TASK]), TASK, 0)
        self.assertEqual((oracle["success"], oracle["efficiency"]), (True, 1.0))
        noop = run_attempt(FakeLab(), NoopAgent(), TASK, 0)
        self.assertEqual((noop["success"], noop["invocations"], noop["efficiency"]), (False, 0, None))

    def test_pass_k(self):
        records = [
            {"task": "a", "level": "DL1", "success": True, "efficiency": 1.0, "goal_fraction": 1.0, "invocations": 1},
            {"task": "a", "level": "DL1", "success": False, "efficiency": None, "goal_fraction": 0.0, "invocations": 2},
            {"task": "b", "level": "DL1", "success": True, "efficiency": 0.5, "goal_fraction": 1.0, "invocations": 2},
            {"task": "b", "level": "DL1", "success": True, "efficiency": 1.0, "goal_fraction": 1.0, "invocations": 1},
        ]
        overall = summarize(records)[-1]
        self.assertEqual((overall["success"], overall["pass^k"], overall["efficiency"]), (0.75, 0.5, 2.5 / 3))


if __name__ == "__main__":
    unittest.main()
