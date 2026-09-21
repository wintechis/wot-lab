#!/usr/bin/env python3
"""Write the benchmark tasks for the converted environments.

A task is what an agent is given (`request`) and what is checked afterwards
(`goal`), plus the plan a perfect agent would run (`optimalPlan`). The tasks
themselves come from the paper; this script holds them in one place so the
parts that depend on the environment are derived rather than transcribed:

  * ids and URLs are the ones wot-lab actually serves, not the dump's
    (`Room_SOR42_G_15-colorlamp` -> `room-sor42-g-15-colorlamp`, a property
    resource -> `/<id>/properties/<name>`);
  * every `goal` is checked against the environment manifest — an unknown Thing
    or Property fails the run rather than reaching a task file;
  * MOSAIK's plans are *computed*. Producing a smartphone is some six hundred
    invocations through a twelve-recipe graph; writing that by hand would be
    both unreadable and wrong.

An Action's `input` is its real WoT payload: `{}` for one that takes none, the
bare value for a scalar schema, an object for an object schema.

    python3 tools/make_tasks.py [--base http://localhost:8081]
"""

from __future__ import annotations

import argparse
import json
import os
import re

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENVS = os.path.join(REPO, "src", "environments")


def slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.strip().lower()).strip("-")


def load_env(name: str) -> dict:
    with open(os.path.join(ENVS, f"{name}.json"), encoding="utf-8") as handle:
        manifest = json.load(handle)
    return {thing["id"]: thing for thing in manifest["things"]}


# ---------------------------------------------------------------------------
# IBM Building 3
# ---------------------------------------------------------------------------


def prop(base: str, thing: str, name: str) -> str:
    return f"{base}/{thing}/properties/{name}"


def building3_tasks(base: str) -> list[dict]:
    lamp15 = "room-sor42-g-15-colorlamp"
    ten = [f"room-sor42-g-{i:02d}-colorlamp" for i in range(1, 11)]
    three = ten[:3]
    four = [f"room-sor42-g-{i}-colorlamp" for i in range(16, 20)]

    def power_on(thing: str) -> dict:
        return {"thing": thing, "action": "setPower", "input": "on"}

    tasks = [
        {
            "id": "b1",
            "request": "Turn on the lamp in room SOR42_G_15.",
            "goal": [{"thing": lamp15, "property": "power", "op": "=", "value": "on"}],
            "optimalPlan": [power_on(lamp15)],
        },
        {
            "id": "b2",
            "request": "Set the brightness of the lamp in room SOR42_G_15 to 123.",
            "goal": [
                {"thing": lamp15, "property": "brightness", "op": "=", "value": 123}
            ],
            # The lamp starts off and brightness only moves while it is on, so
            # the enabling step is part of the shortest plan even though the
            # goal does not mention power.
            "optimalPlan": [
                power_on(lamp15),
                {"thing": lamp15, "action": "setBrightness", "input": 123},
            ],
        },
        {
            "id": "b3",
            "request": "Open the door of the Breakout room.",
            "goal": [
                {
                    "thing": "room-breakout-door-sensor",
                    "property": "isOpen",
                    "op": "=",
                    "value": True,
                }
            ],
            # The sensor owns the Property; the actuator is what writes it.
            "optimalPlan": [
                {
                    "thing": "room-breakout-door-actuator",
                    "action": "setOpen",
                    "input": True,
                }
            ],
        },
        {
            "id": "b4",
            "request": "Close the door and the window of the Breakout room.",
            # Both are shut in the environment's initial state, which would make
            # the goal true before the agent did anything. The task opens them.
            "initialState": {
                "room-breakout-door-sensor": {"isOpen": True},
                "room-breakout-window-sensor": {"isOpen": True},
            },
            "goal": [
                {
                    "thing": "room-breakout-door-sensor",
                    "property": "isOpen",
                    "op": "=",
                    "value": False,
                },
                {
                    "thing": "room-breakout-window-sensor",
                    "property": "isOpen",
                    "op": "=",
                    "value": False,
                },
            ],
            "optimalPlan": [
                {
                    "thing": "room-breakout-door-actuator",
                    "action": "setOpen",
                    "input": False,
                },
                {
                    "thing": "room-breakout-window-actuator",
                    "action": "setOpen",
                    "input": False,
                },
            ],
        },
        {
            "id": "b5",
            "request": "Heat the Breakout room to 22 degrees.",
            "goal": [
                {
                    "thing": "room-breakout-heater-sensor",
                    "property": "temperature",
                    "op": "=",
                    "value": 22,
                }
            ],
            # The room starts at 21. The radiator raises the temperature by one
            # degree per invocation, and only while a setpoint is set and the
            # door and window are shut — both are shut to begin with.
            "optimalPlan": [
                {
                    "thing": "room-breakout-heater",
                    "action": "setDesiredTemperature",
                    "input": 22,
                },
                {
                    "thing": "room-breakout-heater",
                    "action": "increaseTemperature",
                    "input": {},
                },
            ],
        },
        {
            "id": "b6",
            # Rooms are named in words: wot-lab serves no room resources, so the
            # agent has to find each room's lamp through the Brick annotations.
            "request": "Switch on all lamps in rooms SOR42_G_01 to SOR42_G_10.",
            "goal": [
                {"thing": t, "property": "power", "op": "=", "value": "on"} for t in ten
            ],
            "optimalPlan": [power_on(t) for t in ten],
        },
        # Rooms SOR42_G_12 to 14 do not exist in the building; 16 to 19 do.
        {
            "id": "b7",
            "initialState": {t: {"power": "on"} for t in four},
            "request": "Switch off the lamps in rooms SOR42_G_16 to SOR42_G_19.",
            "goal": [
                {"thing": t, "property": "power", "op": "=", "value": "off"} for t in four
            ],
            "optimalPlan": [
                {"thing": t, "action": "setPower", "input": "off"} for t in four
            ],
        },
        {
            "id": "b8",
            "request": "Set the lamps in rooms SOR42_G_01, SOR42_G_02 and SOR42_G_03 to red.",
            "goal": [
                {"thing": t, "property": "color", "op": "=", "value": "red"}
                for t in three
            ],
            # Colour, like brightness, only changes while the lamp is on.
            "optimalPlan": [
                step
                for t in three
                for step in (
                    power_on(t),
                    {"thing": t, "action": "setColor", "input": "red"},
                )
            ],
        },
    ]
    # Three requests that name a room rather than a Thing: the agent has to find
    # the room's devices (rooms.json / brick:isPointOf) before it can act.
    tasks += [
        {"id": "b9",
         "request": "Turn on the light in room 18.",
         "goal": [{"thing": "room-18-colorlamp", "property": "power", "op": "=", "value": "on"}],
         "optimalPlan": [power_on("room-18-colorlamp")]},
        {"id": "b10",
         "request": "Open the window in the Breakout room.",
         "goal": [{"thing": "room-breakout-window-sensor", "property": "isOpen", "op": "=", "value": True}],
         "optimalPlan": [{"thing": "room-breakout-window-actuator", "action": "setOpen", "input": True}]},
        {"id": "b11",
         "request": "Heat room SOR42_G_15 to 23 degrees.",
         "goal": [{"thing": "room-sor42-g-15-heater-sensor", "property": "temperature", "op": "=", "value": 23}],
         "optimalPlan": [{"thing": "room-sor42-g-15-heater", "action": "setDesiredTemperature", "input": 23},
                         {"thing": "room-sor42-g-15-heater", "action": "increaseTemperature", "input": {}},
                         {"thing": "room-sor42-g-15-heater", "action": "increaseTemperature", "input": {}}]},
    ]
    for task in tasks:
        task.setdefault("initialState", {})
        task["environment"] = "ibm-building3"
        task["level"] = "S"
    return tasks


# ---------------------------------------------------------------------------
# MOSAIK: a simulator, so the plans are computed rather than written
# ---------------------------------------------------------------------------


class Shopfloor:
    """Enough of the shopfloor to plan against: positions, states, one transporter.

    Mirrors the `vre:effects` the Things actually run — a carried product moves
    with the transporter, and a produce Action places its output at the station
    only while every input already lies there.
    """

    def __init__(self, things: dict, transporter: str = "t1"):
        self.pos = {
            tid: [thing["state"]["xpos"], thing["state"]["ypos"]]
            for tid, thing in things.items()
            if thing["model"] == "mosaik-product"
        }
        self.state = {
            tid: thing["state"]["state"]
            for tid, thing in things.items()
            if thing["model"] == "mosaik-product"
        }
        self.stations = {
            tid: thing["state"]
            for tid, thing in things.items()
            if thing["model"].startswith("mosaik-")
            and thing["model"]
            not in ("mosaik-product", "mosaik-transporter", "mosaik-shopfloor")
        }
        self.recipes = {
            recipe["output"]: recipe
            for recipe in things["shopfloor"]["state"]["recipes"]
        }
        self.transporter = transporter
        self.at = [
            things[transporter]["state"]["xpos"],
            things[transporter]["state"]["ypos"],
        ]
        self.carrying: str | None = None
        self.plan: list[dict] = []

    # -- primitives ---------------------------------------------------------

    def step(self, thing: str, action: str, value=None) -> None:
        self.plan.append(
            {"thing": thing, "action": action, "input": {} if value is None else value}
        )

    def move_to(self, target: list[float]) -> None:
        while self.at[0] != target[0]:
            forward = target[0] > self.at[0]
            self.at[0] += 1 if forward else -1
            self.step(self.transporter, "moveRight" if forward else "moveLeft")
            self._carry()
        while self.at[1] != target[1]:
            down = target[1] > self.at[1]
            self.at[1] += 1 if down else -1
            self.step(self.transporter, "moveDown" if down else "moveUp")
            self._carry()

    def _carry(self) -> None:
        if self.carrying:
            self.pos[self.carrying] = list(self.at)

    def deliver(self, product: str, target: list[float]) -> None:
        if self.pos[product] == target:
            return
        self.move_to(self.pos[product])
        self.step(self.transporter, "pickup", product)
        self.carrying = product
        self.move_to(target)
        self.step(self.transporter, "drop")
        self.carrying = None

    # -- planning -----------------------------------------------------------

    def distance(self, a: list[float], b: list[float]) -> float:
        return abs(a[0] - b[0]) + abs(a[1] - b[1])

    def serving(self, service: str) -> list[str]:
        return [
            name for name, state in self.stations.items() if state["service"] == service
        ]

    def station_position(self, station: str) -> list[float]:
        return [self.stations[station]["xpos"], self.stations[station]["ypos"]]

    def choose_station(self, service: str, inputs: list[str]) -> str:
        """The station of this service that is cheapest to gather the inputs at."""

        def cost(station: str) -> float:
            where = self.station_position(station)
            outstanding = [p for p in inputs if self.pos[p] != where]
            if not outstanding:
                return 0.0
            legs = sum(self.distance(self.pos[p], where) for p in outstanding)
            approach = min(self.distance(self.at, self.pos[p]) for p in outstanding)
            return legs + approach

        return min(self.serving(service), key=cost)

    def ensure(self, name: str, station: str | None = None) -> None:
        """Produce `name` if it does not exist yet, inputs and transport included."""
        product = slug(name)
        if self.state[product] == "initialState":
            return
        recipe = self.recipes[name]
        inputs = [slug(i) for i in recipe["inputs"]]
        for source in recipe["inputs"]:
            self.ensure(source)

        station = station or self.choose_station(recipe["service"], inputs)
        where = self.station_position(station)

        # Gather greedily: each time, the input that is cheapest to fetch and
        # drop off from where the transporter now stands. Every leg is a
        # shortest path; the order is greedy, not proven optimal.
        outstanding = [p for p in inputs if self.pos[p] != where]
        while outstanding:
            nearest = min(
                outstanding,
                key=lambda p: self.distance(self.at, self.pos[p])
                + self.distance(self.pos[p], where),
            )
            self.deliver(nearest, where)
            outstanding.remove(nearest)

        output = recipe["output"]
        self.step(station, "produce" + output[0].upper() + output[1:], "produceIt")
        self.pos[product] = list(where)
        self.state[product] = "initialState"


def mosaik_tasks(base: str, things: dict) -> list[dict]:
    def at(thing: str, axis: str, value: float) -> dict:
        return {"thing": thing, "property": axis, "op": "=", "value": value}

    def station_xy(name: str) -> list[float]:
        return [things[name]["state"]["xpos"], things[name]["state"]["ypos"]]

    tasks = []

    # S1 — move the transporter to (1, 1).
    floor = Shopfloor(things)
    floor.move_to([1.0, 1.0])
    tasks.append(
        {
            "id": "s1",
            "level": "L2",
            "request": "Move transporter t1 to position (1, 1).",
            "goal": [at("t1", "xpos", 1.0), at("t1", "ypos", 1.0)],
            "optimalPlan": floor.plan,
        }
    )

    # S2 — the same for two transporters. The dump has only t1, so the request
    # cannot be met; the right answer is to do nothing, and the goal says so:
    # t1 exactly where it started. Level L5, plan empty.
    tasks.append(
        {
            "id": "s2",
            "level": "L5",
            "request": "Move transporters t1 and t2 to position (1, 1).",
            "note": (
                "Infeasible: mosaik.trig describes one transporter, so there is"
                " no 't2' to move. The goal is t1 left where it started."
            ),
            "goal": [at("t1", "xpos", 0.0), at("t1", "ypos", 0.0)],
            "optimalPlan": [],
        }
    )

    # S3 — bring the ingot to solder2.
    floor = Shopfloor(things)
    floor.deliver("ingot", station_xy("solder2"))
    tasks.append(
        {
            "id": "s3",
            "level": "L3",
            "request": "Bring the ingot to the solder2 station and put it down there.",
            # "and drop it there": without the carrying predicate the goal holds
            # one step early, while the transporter still holds the ingot.
            "goal": [at("ingot", "xpos", 9.0), at("ingot", "ypos", 12.0),
                     {"thing": "t1", "property": "carrying", "op": "=", "value": False}],
            "optimalPlan": floor.plan,
        }
    )

    # S4 — two products to two stations.
    floor = Shopfloor(things)
    floor.deliver("cpu", station_xy("solder1"))
    floor.deliver("glass", station_xy("casting"))
    tasks.append(
        {
            "id": "s4",
            "level": "L3",
            "request": "Bring the cpu to the solder1 station and the glass to the casting station, and put each down there.",
            "goal": [
                at("cpu", "xpos", 9.0),
                at("cpu", "ypos", 7.0),
                at("glass", "xpos", 25.0),
                at("glass", "ypos", 0.0),
                {"thing": "t1", "property": "carrying", "op": "=", "value": False},
            ],
            "optimalPlan": floor.plan,
        }
    )

    # S5 — produce a main module, at solder1 because the request names it.
    floor = Shopfloor(things)
    floor.ensure("mainModule", station="solder1")
    tasks.append(
        {
            "id": "s5",
            "level": "L3",
            "request": "Produce the main module at the solder1 station.",
            "goal": [
                {
                    "thing": "mainmodule",
                    "property": "state",
                    "op": "=",
                    "value": "initialState",
                }
            ],
            "optimalPlan": floor.plan,
        }
    )

    # S6 — produce a smartphone: the whole recipe graph.
    floor = Shopfloor(things)
    floor.ensure("smartphone")
    tasks.append(
        {
            "id": "s6",
            "level": "L3",
            "request": "Produce the smartphone.",
            "goal": [
                {
                    "thing": "smartphone",
                    "property": "state",
                    "op": "=",
                    "value": "initialState",
                }
            ],
            "optimalPlan": floor.plan,
        }
    )

    for task in tasks:
        task.setdefault("initialState", {})
        task["environment"] = "mosaik"
    return tasks


# ---------------------------------------------------------------------------
# The four service domains
#
# Ported from tasks/planning-tasks.md §3 of the paper repository and checked
# against the environments as they are: every id, price, capacity and initial
# value below is the manifest's or the model's, not the planning notes'.
#
# Level, as applied here: L0 the goal already holds; L1 one Action, goal on
# that Thing; L2 several Actions, goal on the Things acted on; L3 the goal spans
# Things one effect couples, or a step only takes effect after another Thing's;
# L4 several runs reach the requested state but coupling makes all but one
# violate another goal predicate (`distractorPlan` is the tempting one); L5 no
# run reaches it, goal = the state left untouched, plan empty (`naiveAttempt`,
# where one exists that the environment rejects outright).
# ---------------------------------------------------------------------------


def pred(thing: str, prop: str, op: str, value) -> dict:
    return {"thing": thing, "property": prop, "op": op, "value": value}


def step(thing: str, action: str, value=None) -> dict:
    return {"thing": thing, "action": action, "input": {} if value is None else value}


def ecommerce_tasks() -> list[dict]:
    cart, alice, bob, charlie = "cart", "bank-alice", "bank-bob", "bank-charlie"
    add = lambda item: step(cart, "addItem", {"itemId": item})  # noqa: E731
    checkout = lambda account: step(cart, "checkout", {"bankAccount": account})  # noqa: E731
    empty = [pred(cart, "items", "length", 0), pred(cart, "totalAmount", "=", 0)]
    coffee = "Alice wants to upgrade her coffee setup: order the espresso grinder and a bag of coffee beans for her, paid from her bank account."
    tasks = [
        {"id": "ec-0", "level": "L0",
         "request": "Make sure Alice's cart is empty.",
         "goal": empty + [pred(alice, "balance", "=", 5000)],
         "optimalPlan": []},
        {"id": "ec-1", "level": "L1",
         "request": "Put Small Item 1 in Alice's cart.",
         "goal": [pred(cart, "items", "length", 1), pred(cart, "items", "contains", "small-1"),
                  pred(cart, "totalAmount", "=", 1)],
         "optimalPlan": [add("small-1")]},
        {"id": "ec-2", "level": "L2",
         "request": "Alice wants three small items in her cart.",
         "goal": [pred(cart, "items", "length", 3), pred(cart, "totalAmount", "=", 3),
                  pred(alice, "balance", "=", 5000)],
         "optimalPlan": [add("small-1"), add("small-2"), add("small-3")]},
        {"id": "ec-3", "level": "L3",
         "request": coffee,
         "goal": empty + [pred(alice, "balance", "=", 4865), pred(bob, "balance", "=", 100),
                          pred(charlie, "balance", "=", 5000)],
         "optimalPlan": [add("grinder"), add("beans"), checkout(alice)]},
        {"id": "ec-4", "level": "L3",
         "request": "Send Bob $100 from Alice's account.",
         "goal": [pred(alice, "balance", "=", 4900), pred(bob, "balance", "=", 200),
                  pred(cart, "totalAmount", "=", 0)],
         "optimalPlan": [step(alice, "transfer", {"amount": 100, "bankAccount": bob})]},
        # Was L4 "balance exactly $4,995 and cart empty": both runs (withdraw 5;
        # five items + checkout) satisfy every predicate, so nothing is a trap.
        {"id": "ec-5", "level": "L1",
         "request": "Take $5 out of Alice's account.",
         "goal": [pred(alice, "balance", "=", 4995), pred(cart, "items", "length", 0)],
         "optimalPlan": [step(alice, "withdraw", {"amount": 5})]},
        # Was "Buy Small Item 99": addItem accepts any id at price 0, so the
        # request is reachable. The catalog itself is what nothing can change.
        {"id": "ec-6", "level": "L5",
         "request": "Put the espresso grinder on sale for $100.",
         "note": "Unreachable: cart.availableProducts is readOnly and no Action of any Thing writes it (the cart's Actions are addItem, removeItem, checkout). No Action to attempt, so no naiveAttempt.",
         "goal": [pred(cart, "availableProducts", "length", 32)] + empty
                 + [pred(alice, "balance", "=", 5000)],
         "optimalPlan": []},
        # Was L5 "Bob has only $100": bank-account declares no minimum and
        # transfer has no guard, so the environment lets the balance go negative.
        {"id": "ec-7", "level": "L3",
         "request": "Send Charlie $200 from Bob's account; Bob has agreed to go into overdraft for it.",
         "note": "Feasible in this environment: the bank-account TD declares no minimum balance and transfer is unguarded, so Bob's balance goes to -100.",
         "goal": [pred(bob, "balance", "=", -100), pred(charlie, "balance", "=", 5200),
                  pred(alice, "balance", "=", 5000)],
         "optimalPlan": [step(bob, "transfer", {"amount": 200, "bankAccount": charlie})]},
        # Grinder 120 + beans 15 against Bob's 100: checking out on his account
        # alone puts him at -35, which the environment allows and the request
        # forbids. Alice's transfer of exactly the difference is the choice.
        {"id": "ec-8", "level": "L4",
         "request": "Bob wants the espresso grinder and the coffee beans, paid from his own account, but his account must not go below zero; Alice covers the difference.",
         "goal": empty + [pred(bob, "balance", "=", 0), pred(alice, "balance", "=", 4965),
                          pred(charlie, "balance", "=", 5000)],
         "optimalPlan": [step(alice, "transfer", {"amount": 35, "bankAccount": bob}),
                         add("grinder"), add("beans"), checkout(bob)],
         "distractorPlan": [add("grinder"), add("beans"), checkout(bob)]},
        {"id": "ec-9", "level": "L3",
         "request": "Charlie wants to gift Alice the espresso grinder and the coffee beans, and he pays for it: Alice's own balance must not change.",
         "goal": empty + [pred(alice, "balance", "=", 5000), pred(charlie, "balance", "=", 4865),
                          pred(bob, "balance", "=", 100)],
         "optimalPlan": [add("grinder"), add("beans"), checkout(charlie)]},
        {"id": "ec-10", "level": "L3",
         "request": "Alice buys Small Items 1 through 5, and then sends Bob $50.",
         "goal": empty + [pred(alice, "balance", "=", 4945), pred(bob, "balance", "=", 150),
                          pred(charlie, "balance", "=", 5000)],
         "optimalPlan": [add(f"small-{i}") for i in range(1, 6)]
                        + [checkout(alice), step(alice, "transfer", {"amount": 50, "bankAccount": bob})]},
        # ec-3 with the cart already filled: the whole plan is the checkout.
        {"id": "ec-11", "level": "L3",
         "initialState": {cart: {"items": ["grinder", "beans"], "totalAmount": 135}},
         "request": coffee,
         "goal": empty + [pred(alice, "balance", "=", 4865)],
         "optimalPlan": [checkout(alice)]},
        {"id": "ec-12", "level": "L2",
         "request": "Deposit $50 into Alice's account and $25 into Bob's.",
         "goal": [pred(alice, "balance", "=", 5050), pred(bob, "balance", "=", 125),
                  pred(charlie, "balance", "=", 5000)],
         "optimalPlan": [step(alice, "deposit", {"amount": 50}), step(bob, "deposit", {"amount": 25})]},
        {"id": "ec-13", "level": "L5",
         "request": "Change Bob's account number to bob-2.",
         "note": "Unreachable: bank-account.accountNumber is readOnly and no Action writes it (deposit, withdraw and transfer touch balance only). No Action to attempt, so no naiveAttempt.",
         "goal": [pred(bob, "accountNumber", "=", "bob"), pred(bob, "balance", "=", 100)],
         "optimalPlan": []},
    ]
    return finish(tasks, "e-commerce")


def smarthome_tasks() -> list[dict]:
    home, thermo, washer, dryer, car, plug, lamp = (
        "home", "thermostat", "washer", "dryer", "car-charger", "plug", "lamp")
    start = lambda a: step(a, "startAppliance", {"cycle": "normal"})  # noqa: E731
    stop = lambda a: step(a, "stopAppliance")  # noqa: E731
    charge = step(car, "startCharging", {"mode": "standard"})
    set_temp = lambda t: step(thermo, "setTemperature", {"temp": t})  # noqa: E731
    dim = lambda level: step(lamp, "setBrightness", {"level": level})  # noqa: E731
    lamp_req = "Dim my reading lamp to 30 percent."
    tasks = [
        {"id": "sh-0", "level": "L0",
         "request": "Make sure the dryer is not running.",
         "goal": [pred(dryer, "isRunning", "=", False), pred(washer, "isRunning", "=", False),
                  pred(thermo, "targetTemp", "=", 72)],
         "optimalPlan": []},
        {"id": "sh-1", "level": "L1",
         "request": "Set the thermostat to 68 degrees.",
         "goal": [pred(thermo, "targetTemp", "=", 68)],
         "optimalPlan": [set_temp(68)]},
        # Was "start the washer and switch to heat": starting the washer writes
        # the home's power draw, which is the coupling L3 is about.
        {"id": "sh-2", "level": "L2",
         "request": "Set the thermostat to 68 degrees in heat mode.",
         "goal": [pred(thermo, "targetTemp", "=", 68), pred(thermo, "mode", "=", "heat"),
                  pred(dryer, "isRunning", "=", False)],
         "optimalPlan": [set_temp(68), step(thermo, "setMode", {"mode": "heat"})]},
        {"id": "sh-3", "level": "L3",
         "request": "Raise the monthly energy budget to 600 kWh and start charging the car.",
         "goal": [pred(home, "monthlyBudgetKWh", "=", 600), pred(car, "isCharging", "=", True),
                  pred(home, "currentPowerUsageW", "=", 7800)],
         "optimalPlan": [step(home, "setBudget", {"kWh": 600}), charge]},
        {"id": "sh-4", "level": "L3",
         "request": "Run the washer, but keep total power draw at or below 4 kW.",
         "goal": [pred(washer, "isRunning", "=", True), pred(home, "currentPowerUsageW", "<=", 4000),
                  pred(dryer, "isRunning", "=", False), pred(car, "isCharging", "=", False)],
         "optimalPlan": [start(washer)]},
        # Injecting isRunning does not fire the appliance's effect, so the home's
        # draw is injected with it.
        {"id": "sh-5", "level": "L4",
         "initialState": {washer: {"isRunning": True}, home: {"currentPowerUsageW": 2800}},
         "request": "Get the dryer running without going over 4 kW total.",
         "goal": [pred(dryer, "isRunning", "=", True), pred(home, "currentPowerUsageW", "<=", 4000)],
         "optimalPlan": [stop(washer), start(dryer)],
         "distractorPlan": [start(dryer)]},
        {"id": "sh-6", "level": "L5",
         "request": "Set the thermostat to 95 degrees.",
         "note": "Unreachable: thermostat.maxTemp is 85 and setTemperature only writes targetTemp within [minTemp, maxTemp]; setTemperature(95) answers success false and changes nothing.",
         "goal": [pred(thermo, "targetTemp", "=", 72)],
         "optimalPlan": [],
         "naiveAttempt": [set_temp(95)]},
        {"id": "sh-7", "level": "L5",
         "request": "Run the washer, the dryer and the car charger at the same time while keeping power draw under 5 kW.",
         "note": "Unreachable: powerWatts is 2000 (washer), 3000 (dryer) and 7000 (car charger) on top of the home's 800 W base draw — 12800 W with all three on — and no Action changes a powerWatts Property. Every attempt changes state, so no naiveAttempt.",
         "goal": [pred(washer, "isRunning", "=", False), pred(dryer, "isRunning", "=", False),
                  pred(car, "isCharging", "=", False), pred(home, "currentPowerUsageW", "=", 800)],
         "optimalPlan": []},
        {"id": "sh-8", "level": "L3",
         "request": lamp_req,
         # The paper's G_Alice: two predicates, so the plug-only attempt scores 1/2.
         "goal": [pred(lamp, "brightness", "=", 30), pred(lamp, "poweredOn", "=", True)],
         "optimalPlan": [step(plug, "toggle"), dim(30)]},
        {"id": "sh-9", "level": "L0",
         "request": "Make sure the reading lamp is off.",
         "goal": [pred(lamp, "poweredOn", "=", False), pred(plug, "poweredOn", "=", False),
                  pred(thermo, "targetTemp", "=", 72)],
         "optimalPlan": []},
        {"id": "sh-10", "level": "L3",
         "initialState": {washer: {"isRunning": True}, dryer: {"isRunning": True},
                          home: {"currentPowerUsageW": 5800},
                          plug: {"poweredOn": True}, lamp: {"poweredOn": True}},
         "request": "I am leaving: nothing may run, everything off, and the thermostat to 60.",
         "goal": [pred(washer, "isRunning", "=", False), pred(dryer, "isRunning", "=", False),
                  pred(car, "isCharging", "=", False), pred(home, "currentPowerUsageW", "=", 800),
                  pred(lamp, "poweredOn", "=", False), pred(plug, "poweredOn", "=", False),
                  pred(thermo, "targetTemp", "=", 60)],
         "optimalPlan": [stop(washer), stop(dryer), step(plug, "toggle"), set_temp(60)]},
        {"id": "sh-11", "level": "L4",
         "initialState": {washer: {"isRunning": True}, dryer: {"isRunning": True},
                          home: {"currentPowerUsageW": 5800}},
         "request": "Charge the car now and keep total draw at or below 8 kW. Also dim the reading lamp to 20 percent.",
         "goal": [pred(car, "isCharging", "=", True), pred(home, "currentPowerUsageW", "<=", 8000),
                  pred(washer, "isRunning", "=", False), pred(dryer, "isRunning", "=", False),
                  pred(lamp, "brightness", "=", 20), pred(lamp, "poweredOn", "=", True),
                  pred(thermo, "targetTemp", "=", 72)],
         "optimalPlan": [stop(washer), stop(dryer), charge, step(plug, "toggle"), dim(20)],
         "distractorPlan": [charge, step(plug, "toggle"), dim(20)]},
        # sh-8 with the plug already on: toggling is the mistake.
        {"id": "sh-12", "level": "L1",
         "initialState": {plug: {"poweredOn": True}, lamp: {"poweredOn": True}},
         "request": lamp_req,
         "goal": [pred(lamp, "brightness", "=", 30), pred(lamp, "poweredOn", "=", True)],
         "optimalPlan": [dim(30)]},
        {"id": "sh-13", "level": "L1",
         "request": "Raise the monthly energy budget to 600 kWh.",
         "goal": [pred(home, "monthlyBudgetKWh", "=", 600)],
         "optimalPlan": [step(home, "setBudget", {"kWh": 600})]},
        {"id": "sh-14", "level": "L2",
         "request": "Set the energy budget to 450 kWh and the thermostat to 70 degrees.",
         "goal": [pred(home, "monthlyBudgetKWh", "=", 450), pred(thermo, "targetTemp", "=", 70),
                  pred(thermo, "mode", "=", "auto")],
         "optimalPlan": [step(home, "setBudget", {"kWh": 450}), set_temp(70)]},
    ]
    return finish(tasks, "smart-home")


def supplychain_tasks() -> list[dict]:
    a, b, c, system, budget = "warehouse-a", "warehouse-b", "warehouse-c", "warehouse-system", "company-budget"
    order = lambda w, q: step(w, "orderStock", {"quantity": q})  # noqa: E731
    move = lambda src, dst, q: step(src, "transferStock", {"toWarehouse": dst, "quantity": q})  # noqa: E731
    stock = lambda w, n: pred(w, "currentStock", "=", n)  # noqa: E731
    spent = lambda n: pred(budget, "monthlySpent", "=", n)  # noqa: E731
    total = lambda n: pred(system, "totalCurrentStock", "=", n)  # noqa: E731
    c_2000 = "Warehouse C needs 2,000 units, but no money may be spent this month."
    tasks = [
        {"id": "sc-0", "level": "L0",
         "request": "Check that Warehouse C is below 50 % utilisation.",
         "goal": [pred(c, "utilizationPercent", "<", 50), spent(35000), total(4500)],
         "optimalPlan": []},
        {"id": "sc-1", "level": "L1",
         "request": "Bring Warehouse C's stock to 1,500 units.",
         "goal": [stock(c, 1500)],
         "optimalPlan": [order(c, 300)]},
        # Was L2: one transfer, but its goal spans the two warehouses it couples.
        {"id": "sc-2", "level": "L3",
         "request": "Move 500 units from Warehouse A to Warehouse B.",
         "goal": [stock(a, 1000), stock(b, 2300), spent(35000)],
         "optimalPlan": [move(a, b, 500)]},
        {"id": "sc-3", "level": "L4",
         "request": c_2000,
         "goal": [stock(c, 2000), spent(35000), total(4500)],
         "optimalPlan": [move(a, c, 800)],
         "distractorPlan": [order(c, 800)]},
        # +1000 units. The 60 % caps are A 1800, B 2400, C 1800, so no single
        # order of 1,000 fits anywhere; two orders, 50,000 in all.
        {"id": "sc-4", "level": "L4",
         "request": "Raise total stock to 5,500 units with no warehouse above 60 % utilisation.",
         "goal": [total(5500), pred(a, "utilizationPercent", "<=", 60),
                  pred(b, "utilizationPercent", "<=", 60), pred(c, "utilizationPercent", "<=", 60),
                  spent(85000)],
         "optimalPlan": [order(b, 600), order(c, 400)],
         "distractorPlan": [order(b, 1000)]},
        {"id": "sc-5", "level": "L5",
         "request": "Bring Warehouse C to 4,000 units.",
         "note": "Unreachable: warehouse-c.capacity is 3000; orderStock and transferStock both leave stock unchanged when it would exceed capacity (success false).",
         "goal": [stock(c, 1200), spent(35000), total(4500)],
         "optimalPlan": [],
         "naiveAttempt": [order(c, 2800)]},
        {"id": "sc-6", "level": "L4",
         "request": "Get 800 more units into Warehouse C, but the remaining budget must stay above $60,000.",
         "goal": [stock(c, 2000), pred(budget, "remainingBudget", ">", 60000)],
         "optimalPlan": [move(a, c, 800)],
         "distractorPlan": [order(c, 800)]},
        {"id": "sc-7", "level": "L3",
         "request": "Order 300 units for each warehouse, then move 200 units from Warehouse B to Warehouse A.",
         "goal": [stock(a, 2000), stock(b, 1900), stock(c, 1500), spent(80000), total(5400)],
         "optimalPlan": [order(a, 300), order(b, 300), order(c, 300), move(b, a, 200)]},
        # 50 % of every capacity sums to 5,000 units; the floor holds 4,500 and
        # only orders add stock — and every order spends.
        {"id": "sc-8", "level": "L5",
         "request": "Bring every warehouse to exactly 50 % utilisation without spending anything.",
         "note": "Unreachable: the targets (1500, 2000, 1500) sum to 5000 against warehouse-system.totalCurrentStock 4500; transferStock conserves the total and orderStock is the only Action that raises it, and it writes company-budget.monthlySpent every time. Every attempt changes state, so no naiveAttempt.",
         "goal": [stock(a, 1500), stock(b, 1800), stock(c, 1200), spent(35000)],
         "optimalPlan": []},
        # C +1500 and B +800: ordering both costs 115,000, ordering C alone
        # 75,000. A holds exactly the 1,500 C needs; B's 800 fit the budget.
        {"id": "sc-9", "level": "L4",
         "request": "Get Warehouse C to 2,700 units and Warehouse B to 2,600, spending at most $40,000.",
         "goal": [stock(c, 2700), stock(b, 2600), pred(budget, "monthlySpent", "<=", 75000), stock(a, 0)],
         "optimalPlan": [move(a, c, 1500), order(b, 800)],
         "distractorPlan": [order(c, 1500), order(b, 800)]},
        # A must shed 500, B needs 500 and C 400: the 500 move A->B, the 400 an
        # order (20,000). Ordering what B and C lack costs 45,000 and leaves A.
        {"id": "sc-10", "level": "L4",
         "request": "Warehouse A should hold 1,000 units, Warehouse B 2,300 and Warehouse C 1,600, spending at most $20,000.",
         "goal": [stock(a, 1000), stock(b, 2300), stock(c, 1600),
                  pred(budget, "monthlySpent", "<=", 55000), total(4900)],
         "optimalPlan": [move(a, b, 500), order(c, 400)],
         "distractorPlan": [order(b, 500), order(c, 400)]},
        # sc-3 with C already at 2,000: nothing to do.
        {"id": "sc-11", "level": "L0",
         "initialState": {c: {"currentStock": 2000, "utilizationPercent": 2000 / 3000 * 100},
                          system: {"totalCurrentStock": 5300}},
         "request": c_2000,
         "goal": [stock(c, 2000), spent(35000), total(5300)],
         "optimalPlan": []},
        # sc-3 with A nearly empty: the transfer from A is refused, B must give.
        {"id": "sc-12", "level": "L4",
         "initialState": {a: {"currentStock": 300, "utilizationPercent": 300 / 3000 * 100},
                          system: {"totalCurrentStock": 3300}},
         "request": c_2000,
         "goal": [stock(c, 2000), spent(35000), total(3300), stock(a, 300)],
         "optimalPlan": [move(b, c, 800)],
         "distractorPlan": [move(a, c, 800)]},
        {"id": "sc-13", "level": "L1",
         "request": "Order 400 units for Warehouse B.",
         "goal": [stock(b, 2200), spent(55000)],
         "optimalPlan": [order(b, 400)]},
        {"id": "sc-14", "level": "L2",
         "request": "Order 200 units each for Warehouse A and Warehouse C.",
         "goal": [stock(a, 1700), stock(c, 1400), stock(b, 1800)],
         "optimalPlan": [order(a, 200), order(c, 200)]},
        {"id": "sc-15", "level": "L2",
         "request": "Order 100 more units each for Warehouse A and Warehouse B.",
         "goal": [stock(a, 1600), stock(b, 1900), stock(c, 1200)],
         "optimalPlan": [order(a, 100), order(b, 100)]},
    ]
    return finish(tasks, "supply-chain")


def socialmedia_tasks() -> list[dict]:
    alice, bob, charlie = "alice", "bob", "charlie"
    post = lambda page, text: step(page, "createPost", {"content": text})  # noqa: E731
    follow = lambda page, other: step(page, "followUser", {"pageUri": other})  # noqa: E731
    unfollow = lambda page, other: step(page, "unfollowUser", {"pageUri": other})  # noqa: E731
    count = lambda page, which, n: pred(page, which, "=", n)  # noqa: E731
    charlie_post = {charlie: {"posts": [{"id": "post-1", "content": "First post!"}]}}
    everyone = "Bob should follow both Alice and Charlie."
    tasks = [
        {"id": "sm-0", "level": "L0",
         "request": "Make sure Alice follows Bob.",
         "goal": [pred(alice, "following", "contains", bob), count(bob, "followingCount", 0),
                  count(bob, "postCount", 0)],
         "optimalPlan": []},
        {"id": "sm-1", "level": "L1",
         "request": 'Post "hello" on Bob\'s page.',
         "goal": [count(bob, "postCount", 1)],
         "optimalPlan": [post(bob, "hello")]},
        {"id": "sm-2", "level": "L3",
         "request": "Bob wants to follow Alice.",
         "goal": [pred(bob, "following", "contains", alice), pred(alice, "followers", "contains", bob),
                  count(alice, "followerCount", 2)],
         "optimalPlan": [follow(bob, alice)]},
        {"id": "sm-3", "level": "L3",
         "request": everyone,
         "goal": [count(bob, "followingCount", 2), count(alice, "followerCount", 2),
                  count(charlie, "followerCount", 1)],
         "optimalPlan": [follow(bob, alice), follow(bob, charlie)]},
        {"id": "sm-4", "level": "L3",
         "initialState": charlie_post,
         "request": "Bob likes Charlie's post.",
         "goal": [count(charlie, "likesReceived", 1), pred(bob, "likedPosts", "length", 1),
                  pred(bob, "likedPosts", "contains", "post-1")],
         "optimalPlan": [step(bob, "likePost", {"pageUri": charlie, "postId": "post-1"})]},
        # Constants stand in for the Property-to-Property comparison the
        # predicate language does not have; the second clause of the request
        # rules out the other equalising run (both followers unfollow).
        {"id": "sm-5", "level": "L4",
         "request": "Bob's page should show as many people followed as followers, and he must not lose any followers.",
         "goal": [count(bob, "followingCount", 2), count(bob, "followerCount", 2)],
         "optimalPlan": [follow(bob, alice), follow(bob, charlie)],
         "distractorPlan": [unfollow(alice, bob), unfollow(charlie, bob)]},
        # Was "five followers": followUser appends without checking, so four
        # follows from one page reach five. Posts, by contrast, cannot be removed.
        {"id": "sm-6", "level": "L5",
         "initialState": charlie_post,
         "request": "Delete Charlie's post.",
         "note": "Unreachable: social-page has no Action that removes a post (createPost, followUser, unfollowUser, likePost) and posts is readOnly. No Action to attempt, so no naiveAttempt.",
         "goal": [count(charlie, "postCount", 1), pred(charlie, "posts", "length", 1)],
         "optimalPlan": []},
        {"id": "sm-7", "level": "L0",
         "request": "Bob stops following Charlie.",
         "goal": [count(bob, "followingCount", 0), count(charlie, "followerCount", 0)],
         "optimalPlan": []},
        {"id": "sm-8", "level": "L3",
         "initialState": charlie_post,
         "request": "Charlie's post should have a like from everyone else.",
         "goal": [count(charlie, "likesReceived", 2), pred(alice, "likedPosts", "contains", "post-1"),
                  pred(bob, "likedPosts", "contains", "post-1"), pred(charlie, "likedPosts", "length", 0)],
         "optimalPlan": [step(alice, "likePost", {"pageUri": charlie, "postId": "post-1"}),
                         step(bob, "likePost", {"pageUri": charlie, "postId": "post-1"})]},
        {"id": "sm-9", "level": "L3",
         "request": 'Make it mutual: everyone should follow everyone else. Then Alice posts "welcome".',
         "goal": [count(p, which, 2) for p in (alice, bob, charlie) for which in ("followingCount", "followerCount")]
                 + [count(alice, "postCount", 1)],
         "optimalPlan": [follow(alice, charlie), follow(bob, alice), follow(bob, charlie), post(alice, "welcome")]},
        # sm-3 with Alice already followed: following her again would append a
        # duplicate.
        {"id": "sm-10", "level": "L3",
         "initialState": {bob: {"following": [alice]}, alice: {"followers": [charlie, bob]}},
         "request": everyone,
         "goal": [count(bob, "followingCount", 2), count(alice, "followerCount", 2),
                  count(charlie, "followerCount", 1)],
         "optimalPlan": [follow(bob, charlie)]},
        {"id": "sm-11", "level": "L1",
         "request": 'Post "good morning" on Alice\'s page.',
         "goal": [count(alice, "postCount", 1)],
         "optimalPlan": [post(alice, "good morning")]},
        {"id": "sm-12", "level": "L2",
         "request": 'Bob posts "one" and then "two".',
         "goal": [count(bob, "postCount", 2)],
         "optimalPlan": [post(bob, "one"), post(bob, "two")]},
        {"id": "sm-13", "level": "L2",
         "request": "Alice and Charlie each post a greeting.",
         "goal": [count(alice, "postCount", 1), count(charlie, "postCount", 1), count(bob, "postCount", 0)],
         "optimalPlan": [post(alice, "hi"), post(charlie, "hi")]},
    ]
    return finish(tasks, "social-media")


def finish(tasks: list[dict], environment: str) -> list[dict]:
    for task in tasks:
        task.setdefault("initialState", {})
        task["environment"] = environment
    return tasks


# ---------------------------------------------------------------------------


def check(tasks: list[dict], things: dict, models: dict) -> list[str]:
    """Every goal and every plan step has to name something the lab runs."""
    problems = []
    for task in tasks:
        for goal in task["goal"]:
            thing = things.get(goal["thing"])
            if thing is None:
                problems.append(f"{task['id']}: goal names unknown Thing '{goal['thing']}'")
                continue
            # Against the model's TD, not the manifest's state: derived Properties
            # (utilizationPercent, followerCount) are served without being stored.
            declared = models[thing["model"]].get("properties") or {}
            if goal["property"] not in declared:
                problems.append(
                    f"{task['id']}: {goal['thing']} has no Property '{goal['property']}'"
                )
        plans = [task.get("optimalPlan") or [], task.get("distractorPlan") or [],
                 task.get("naiveAttempt") or []]
        for step in (s for plan in plans for s in plan):
            thing = things.get(step["thing"])
            if thing is None:
                problems.append(f"{task['id']}: plan names unknown Thing '{step['thing']}'")
                continue
            actions = models[thing["model"]].get("actions") or {}
            if step["action"] not in actions:
                problems.append(
                    f"{task['id']}: {thing['model']} has no Action '{step['action']}'"
                )
    return problems


def load_models() -> dict:
    models = {}
    things_dir = os.path.join(REPO, "src", "things")
    for name in os.listdir(things_dir):
        td = os.path.join(things_dir, name, f"{name}.td.json")
        if os.path.exists(td):
            with open(td, encoding="utf-8") as handle:
                models[name] = json.load(handle)
    return models


def write(name: str, tasks: list[dict]) -> None:
    directory = os.path.join(ENVS, name)
    os.makedirs(directory, exist_ok=True)
    order = ["id", "environment", "level", "initialState", "request", "note", "goal",
             "optimalPlan", "distractorPlan", "naiveAttempt"]
    ordered = [{k: t[k] for k in order if k in t} for t in tasks]
    with open(os.path.join(directory, "tasks.json"), "w", encoding="utf-8") as handle:
        json.dump(ordered, handle, indent=2, ensure_ascii=False)
        handle.write("\n")
    steps = sum(len(t.get("optimalPlan") or []) for t in tasks)
    print(f"{name}: {len(tasks)} tasks, {steps} plan steps")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="http://localhost:8081")
    args = parser.parse_args()

    models = load_models()
    problems = []

    b3 = load_env("ibm-building3")
    b3_tasks = building3_tasks(args.base)
    problems += check(b3_tasks, b3, models)
    write("ibm-building3", b3_tasks)

    # The subset environment gets the tasks whose Things it actually holds.
    small = load_env("ibm-building3-small")
    subset = [
        dict(task, environment="ibm-building3-small")
        for task in b3_tasks
        if all(goal["thing"] in small for goal in task["goal"])
    ]
    problems += check(subset, small, models)
    write("ibm-building3-small", subset)

    for name, build in (("e-commerce", ecommerce_tasks), ("smart-home", smarthome_tasks),
                        ("supply-chain", supplychain_tasks), ("social-media", socialmedia_tasks)):
        env = load_env(name)
        tasks = build()
        problems += check(tasks, env, models)
        write(name, tasks)

    mosaik = load_env("mosaik")
    m_tasks = mosaik_tasks(args.base, mosaik)
    problems += check(m_tasks, mosaik, models)
    write("mosaik", m_tasks)

    if problems:
        raise SystemExit("\n".join(["unresolved references:"] + problems))


if __name__ == "__main__":
    main()
