# WoT Lab

> A Web of Things (WoT) development framework for rapid IoT device prototyping and testing.

WoT Lab creates a new Thing from a folder of convention-named files:

- **Thing Description** (`.td.json`) — capabilities in W3C WoT format. **Required.**
- **State** (`state.json`) — initial property values / device state. **Required.**
- **Logic** (`logic.js`) — imperative behavior and interaction handlers. **Optional.**
- **Effects** (`vre:effects` in action affordances) — declarative action effects in the VRE language. **Optional.**

A Thing needs only its TD and state; behavior can come from `logic.js`, `vre:effects` annotations, or both. With neither, property handlers are generated from the TD — reads for every property, writes for the ones it does not mark `readOnly` — so the Thing is usable without any code. See [Creating Things](#creating-things) for detailed examples.

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [Features](#features)
- [Configuration](#configuration)
- [Creating Things](#creating-things)
- [API Reference](#api-reference)
- [Security](#security)
- [Examples](#examples)

## Overview

WoT Lab provides a simplified development environment for creating virtual **Web of Things** - devices that follow W3C Web of Things standards.

## Quick Start

```bash
# Install dependencies
bun install

# Start the lab (no Things running yet — add them in the dashboard)
bun run dev

# Or start some Things straight away
bun run dev -- --things counter:2,lamp:1

# Or see it with a few Things already running
bun run dev:demo
```

Open `http://localhost:8081/` in a browser to see the dashboard, or use a WoT client to fetch Thing Descriptions and interact with the Things.

## Features

### Dashboard

The lab serves a React dashboard at `http://localhost:8081/`: it lists the running
Things, inspects each one's properties, actions, events and Thing Description, and allows you to interact with them.
**Add Thing** allows you to create a new Thing off of a pre-defined or new Thing Model.
**Environment** starts one of the manifests in `src/environments/`, replacing whatever is
running. **Replay a run** opens a run file (or a task's plan), replays it against the reset
environment and shows how much of the task's goal holds after every step — see
[`tools/README.md`](tools/README.md#run-files-runschemajson) for the file format.

### State Management

WoT Lab provides two ways to interact with your IoT Things:

1. **Global State Tracking**: All Thing states tracked in [`globalState`](./src/globalState.ts#L10) using [Valtio proxies](https://valtio.dev/docs/api/basic/proxy) for reactivity (in-process only)

2. **WoT Protocol**: Standard Web of Things interaction patterns via Thing Descriptions served by `@node-wot`

## Configuration

### Command line

```bash
bun run dev -- --things counter:3,lamp    # 3 counters and 1 lamp
bun run dev -- --env e-commerce           # a whole scenario in one command
bun run dev -- --port 9000                # or WOT_LAB_PORT=9000
```

- `--things <model>[:<count>],…` — Things to start, named by the Thing Model they
  are built from. The count is optional and defaults to 1. Omit the flag entirely
  to start empty.
- `--env <name>` — an [environment](#environments) to bring online: a named
  bundle of Thing Models with fixed instance ids and initial state (or
  `WOT_LAB_ENV`).
- `--port <number>` — HTTP port. Defaults to `8081`, or `WOT_LAB_PORT`.
- `--models-dir <path>` — where Thing Models authored in the dashboard are
  written (or `WOT_LAB_MODELS_DIR`). Unset, they are written alongside the
  bundled ones in `src/things/`. 


## Creating Things

### Overview

A Thing Model is a dedicated directory in `src/things/`. **Add Thing** in the dashboard
writes exactly the files described below, so you can add them via the dashboard or by hand.

A Thing Model directory contains:

1. **Thing Description** (TD) — JSON file describing capabilities. With `vre:effects`, describing the Thing's behavior. **Required.**
2. **State** — JSON object defining initial properties. **Required.**
3. **Logic** — JavaScript code defining behavior. **Optional.**

Provide behavior with `logic.js`, `vre:effects` annotations, or both. With neither, WoT Lab generates property handlers from the TD: a read handler for every property, and a write handler for each one not marked `readOnly`, so a writable property can actually be set. The Thing's state is readable, writable and observable without a line of code.

### Folder Structure

To add a new Thing called `mydevice`:

```
src/things/mydevice/
├── mydevice.td.json    # Thing Description   (required)
├── state.json          # Initial state       (required)
└── logic.js            # Imperative behavior  (optional)
```

### File Templates

#### 1. Thing Description (`mydevice.td.json`)

WoT Thing Description in JSON format following W3C standards:

```json
{
  "@context": "https://www.w3.org/2019/wot/td/v1",
  "@type": "Thing",
  "title": "My Device",
  "description": "A sample IoT device",
  "properties": {
    "status": {
      "type": "boolean",
      "description": "Device status",
      "observable": true,
      "readOnly": true
    }
  },
  "actions": {
    "toggle": {
      "description": "Toggle device status"
    }
  }
}
```

#### 2. State (`state.json`)

JSON object literal defining initial state:

```json
{
  "status": false,
  "lastUpdated": "2025-08-05T00:00:00.000Z"
}
```

#### 3. Logic (`logic.js`) — optional

JavaScript code with handler functions and helpers. It is read as text and `eval`'d with `thing`, `state`, `http`, `URL`, and `createLoggers` in scope (no imports needed).

> **`logic.js` is trusted code, not a sandbox.** It runs inside the lab's process with the lab's
> privileges — it can read files, open sockets and reach anything the process can. Only start
> Thing Models you would run as a script. See [Security](#security).

```javascript
// Helper functions (if needed)
function validateInput(value) {
  return typeof value === 'boolean';
}

// Property read handlers
thing.setPropertyReadHandler("status", async () => state.status);
thing.setPropertyReadHandler("lastUpdated", async () => state.lastUpdated);

// Action handlers
thing.setActionHandler("toggle", async () => {
  state.status = !state.status;
  state.lastUpdated = new Date().toISOString();
  thing.emitPropertyChange("status");
  thing.emitPropertyChange("lastUpdated");
  return undefined;
});

console.log("mydevice logic initialized");
```

#### 4. Effects (`vre:effects`) — optional

Instead of (or alongside) hand-written action handlers, an action's behavior can
be declared on the affordance itself with a `vre:effects` annotation, written in
**VRE**, the V-Realm effect language:

```json
"actions": {
  "toggle": {
    "title": "Toggle",
    "vre:effects": "status' = !status; emitEvent(\"changed\", status');"
  },
  "setLevel": {
    "input": { "type": "number" },
    "vre:effects": "level' = input;"
  }
}
```

- **Effects** `property' = expr` compile to a state assignment plus a
  property-change notification, so the change is observable and not merely
  readable. The right-hand side supports arithmetic, boolean and comparison
  operators, `?:`, and `[]` / `append` / `remove`.
- **Snapshot semantics**: every effect's right-hand side is evaluated against a
  pre-state snapshot, then all effects apply at once — so an effect can read a
  value another effect in the same action overwrites (V-Realm's flat effects).
- **Pre/post references**: in expressions, an unprimed reference is the
  **pre-state** value and a primed reference (`x'`) is the **post-state** value;
  primes are not allowed on the right-hand side of an effect. (That is why the
  `toggle` example emits `status'` — the new value.)
- **References**: a bare identifier naming one of the action's input parameters
  resolves to that input; otherwise it resolves to a Thing property. Effect
  targets (left of `'`) must be Thing properties. `this.id` is the running
  instance's own id.
- **Cross-Thing effects**: a dotted `handle.prop` (as a target or a value) names
  a property on *another* Thing, where `handle` is a static binding
  (`const bank = <bank-id>`), an action input parameter carrying a Thing
  reference, or a Thing property whose value is a Thing reference (so one shared
  model can target a per-instance device — a plug's `device.poweredOn'`).
  Everything is in-process — the write lands on the other Thing's state and fires
  its change notification, no remote call. Used for the bank
  `transfer`, cart `checkout`, warehouse `orderStock`/`transferStock`, and the
  social follow/like effects (see [Environments](#environments)).
- **Outputs**: `output.<path> = expr` (nested paths allowed) builds the action's
  return value, evaluated after effects apply. Behaviour VRE cannot express
  (array lookups, sums, object construction) stays in `logic.js`, which composes
  with `vre:effects`.
- **No functions**: an effect reads the Thing's state and the action's input and
  nothing else — no time, no calls — so a run is reproducible from its initial
  state alone. Behaviour that needs more belongs in `logic.js`.
- **Input parameters**: an object `input` schema exposes each of its properties
  by name; a scalar `input` is referred to as `input`.
- **Events** are emitted with `emitEvent("name", value)`.


## API Reference

WoT Lab exposes one HTTP server from `@node-wot/binding-http`. It listens on port `8081` by default; use `--port` or `WOT_LAB_PORT` to change it.

The root path is content-negotiated: request `Accept: application/json` for a machine-readable list of Things, or `Accept: text/html` for a browsable directory. A Thing path requested with `Accept: text/html` shows links for its Thing Description, properties, observations, actions, and events. Requests with other `Accept` values continue to the standard WoT routes below.

### Endpoint shapes

Replace `{thingId}` with the exposed instance ID (for example, `counter` or `counter-2`). Use the `forms` in the returned Thing Description when a Thing uses URI variables or a non-default content type.

| Operation | HTTP endpoint | Method | Notes |
|-----------|---------------|--------|-------|
| Fetch Thing Description | `/{thingId}` | `GET` | Returns the TD, including generated `forms`. |
| Read all properties | `/{thingId}/properties` | `GET` | Returns a JSON object of readable properties. |
| Read one property | `/{thingId}/properties/{propertyName}` | `GET` | Available for readable properties. |
| Write all properties | `/{thingId}/properties` | `PUT` | Only available when the TD declares writable properties. |
| Write one property | `/{thingId}/properties/{propertyName}` | `PUT` | Only available for writable properties. |
| Observe a property | `/{thingId}/properties/{propertyName}/observable` | `GET` | Long-poll stream for properties marked `observable`. |
| Invoke an action | `/{thingId}/actions/{actionName}` | `POST` | Send the action input as the request body. |
| Subscribe to an event | `/{thingId}/events/{eventName}` | `GET` | Long-poll stream of emitted event data. |

The property collection routes also support the binding's multiple-property operations where described by the TD forms. `PUT` is not available for the current included Things because their properties are read-only. Event and property observation are long-poll HTTP subscriptions; a WoT client such as the examples below handles the protocol details.

### Lab API (`/_lab`)

The dashboard drives the same registry the `--things` flag does, through these
routes. `_lab` is a reserved path segment, so it can never shadow a Thing.

| Operation | HTTP endpoint | Method | Notes |
|-----------|---------------|--------|-------|
| List Thing Models on disk | `/_lab/thing-models` | `GET` | The catalog in `src/things/`. |
| List running Things | `/_lab/things` | `GET` | Also returns the command that reproduces them: `--env` for a running environment, `--things` for the rest. |
| Create Things | `/_lab/things` | `POST` | `{"model": "lamp", "count": 2}` |
| Take a Thing offline | `/_lab/things/{thingId}` | `DELETE` | Add `?files=true&model=<model>` to delete the Thing Model too. |
| Take every Thing offline | `/_lab/things` | `DELETE` | Leaves an empty lab. |
| Preview a new Thing Model | `/_lab/thing-models/validate` | `POST` | Returns the files that would be written, plus any errors. |
| Create a Thing Model | `/_lab/thing-models` | `POST` | Writes `src/things/<name>/` and creates one Thing from it. |
| List environments | `/_lab/environments` | `GET` | The scenario manifests on disk. |
| Start an environment | `/_lab/environments` | `POST` | `{"name": "e-commerce"}`. Refused if any of its ids is in use, unless `"replace": true` takes everything running offline first. |
| List an environment's tasks | `/_lab/environments/{name}/tasks` | `GET` | The records of its `tasks.json`. |
| Reset to initial state | `/_lab/reset` | `POST` | All Things, or one with `{"id": ...}`. |
| Inject property values | `/_lab/state` | `POST` | `{"id": ..., "values": {...}}`; bypasses TD writability. |

`/_lab/things` is the collection of running Things: `GET` lists them, `POST` adds
more from a Thing Model.

<<<<<<< HEAD
=======
<<<<<<< Updated upstream
=======
>>>>>>> 1eda42e (tidy up)
## Environments

An **environment** is a named bundle of Thing Models with **fixed instance ids**,
optional per-Thing `state` overrides and per-instance `links` (one shared model
can point at a different related Thing per instance), and optional URI→id
aliases — one JSON manifest in
`src/environments/<name>.json`. It is the
reproducible unit a benchmark runs against: the same Things, ids and initial
state, started by one command. (Unlike `--things` and the dashboard's **Add Thing**,
which *allocate* ids, an environment *pins* them, so a scenario's cross-Thing
references resolve to the same instances every run.)

```jsonc
{
  "name": "e-commerce",
  "things": [
    { "model": "shopping-cart", "id": "cart" },
    { "model": "bank-account", "id": "bank-alice", "state": { "balance": 5000 } }
  ]
}
```

```bash
bun run dev -- --env e-commerce                 # start a scenario
curl localhost:8081/_lab/environments           # list what's available, and which one is running
curl -X POST localhost:8081/_lab/environments -d '{"name":"smart-home","replace":true}'   # swap the running lab for it
curl localhost:8081/_lab/environments/smart-home/tasks   # its benchmark tasks
curl -X POST localhost:8081/_lab/reset          # reset every Thing to initial state
curl -X POST localhost:8081/_lab/state  -d '{"id":"bank-alice","values":{"balance":1000}}'
```

Seven environments ship, each built from Thing Models under `src/things/` with
cross-Thing `vre:effects` (and `logic.js` only where VRE can't reach):

| Environment | Things | Tasks | |
| --- | --- | --- | --- |
| `e-commerce` | 4 | 14 | A shopping cart and three bank accounts; checkout and transfer are cross-Thing effects. |
| `supply-chain` | 6 | 16 | Three warehouses, their aggregate, a company budget and a supplier; orders charge the budget, transfers move stock. |
| `social-media` | 3 | 14 | Three pages of a decentralized social network; following and liking are cross-Thing effects. |
| `smart-home` | 7 | 15 | A home energy hub, thermostat, washer, dryer, car charger, and a plug powering a lamp. |
| `ibm-building3` | 2279 | 11 | An office building: 281 rooms, each with a colour lamp, radiator, temperature sensor, and door and window sensors and actuators. |
| `ibm-building3-small` | 17 | 4 | Two rooms of the same building, for iterating without the wait. |
| `mosaik` | 37 | 6 | A shopfloor: 25 products, ten workstations, a transporter and the recipe book. |

The last three are converted from the tee-wip paper repository by
<<<<<<< HEAD
`tools/tee2wotlab.py`. Each environment's benchmark tasks live in
=======
`tools/tee2wotlab.py`; [`NOTICE.md`](NOTICE.md) records where their data comes from. Each environment's benchmark tasks live in
>>>>>>> 1eda42e (tidy up)
`src/environments/<name>/tasks.json`; see [`tools/README.md`](tools/README.md).

All `/_lab` writes are loopback-only unless `WOT_LAB_ALLOW_REMOTE_WRITE=1`.

<<<<<<< HEAD
=======
>>>>>>> Stashed changes
>>>>>>> 1eda42e (tidy up)
A new Thing Model is sent either as a `spec` (the shape the dashboard form
produces) or as a `draft` (the two files verbatim). Both go through the same
validation: names must be slugs, every property and nested member needs a type,
every property needs an initial state value of that type, and any `vre:effects`
program must compile — so a Thing that would not work never reaches disk.

Writes are refused from anywhere but localhost, since this API creates files and
the WoT server binds every interface. Set `WOT_LAB_ALLOW_REMOTE_WRITE=1` for a
deliberately shared lab.

## Examples

### Included Things

WoT Lab comes with example Things:

#### Brightness Sensor
- **Properties**: `brightness`, `lastUpdated`
- **Features**: Environmental light level monitoring in lux (0-100,000), read-only sensor

#### Counter
- **Properties**: `count`
- **Actions**: `increment`, `decrement`, `reset`
- **Features**: Supports step parameter via URI variables

#### Lamp  
- **Properties**: `on`, `brightness`
- **Actions**: `toggle`, `setBrightness`
- **Features**: Brightness validation, state-dependent actions

#### Presence Sensor
- **Properties**: `isPresent`, `lastDetection`, `detectionCount`
- **Events**: `presence`, `absence` (with timestamps and metadata)
- **Features**: Duration tracking, real-time events

#### RuuviTag Sensor
- **Properties**: `temperature`, `humidity`, `pressure`, `acceleration`, `batteryInfo`, `movementCounter`, `sequenceNumber`
- **Events**: `sensorData`, `movementDetected` (with comprehensive sensor data)
- **Actions**: `simulateReading` (with optional parameters for temperature, humidity, movement)
- **Features**: Multi-sensor environmental monitoring, movement detection, automatic data simulation every 10s

#### BLE RGB Controller
- **Properties**: `currentColor`, `power`, `currentEffect`, `brightness`, `lastUpdated`
- **Events**: `colorChanged`, `powerChanged`, `effectChanged` (with timestamps and command data)
- **Actions**: `setColor`, `setPower`, `setEffect`, `setBrightness` (full LED control)
- **Features**: RGB LED control with BLE command simulation, brightness adjustment

## Security

WoT Lab is a development tool, and it is built to be run on a machine you trust, for people you trust.

- **A Thing Model is code.** `logic.js` is `eval`'d in the lab's process with no isolation. Treat a
  Thing Model from someone else like any other script you are about to run. (`vre:effects` are
  narrower: they are parsed, and only what the parser accepts is compiled — literals and names are
  emitted as quoted strings — so an effect can change state but cannot call out of it.)
- **The server listens on every interface** (`*:8081`), so the Things — their Thing Descriptions,
  properties, actions and events — are reachable by anyone who can reach the port. There is no
  authentication; every Thing is served with the `nosec` security scheme.
- **The lab API (`/_lab`) accepts writes from this machine only.** It creates files and starts
  Things, so requests that change anything are refused unless they come from a loopback address.
  `WOT_LAB_ALLOW_REMOTE_WRITE=1` lifts that for a deliberately shared lab; set it only on a
  network where everyone who can reach the port may write Thing Models to the models directory,
  start and stop Things, and overwrite their state. The API writes a Thing Description and a
  `state.json`, never a `logic.js`.

To report a vulnerability, see [`SECURITY.md`](SECURITY.md).

## Deployment

`.github/workflows/cd.yml` deploys `main`. It packages **code only** — `src`,
`frontend/dist`, and the manifests — and unpacks each release side by side on
the server, switching between them with one symlink:

```
~/wot-lab/
├── current -> releases/<commit sha>
├── releases/<commit sha>/        # code, replaced every deploy
└── shared/
    ├── node_modules/             # one install, symlinked into each release
    └── thing-models/             # Thing Models authored in the dashboard
```

### The service

An example unit; adjust the user, paths, port and Things to your host.

```ini
[Unit]
Description=WoT Lab
After=network.target

[Service]
WorkingDirectory=/home/<user>/wot-lab/current
Environment="DEBUG=wot-lab:*"
# Lets anyone who can reach the port author Thing Models and start Things.
# Leave it out unless the lab is meant to be shared; see Security.
# Environment="WOT_LAB_ALLOW_REMOTE_WRITE=1"
ExecStart=/usr/local/bin/bun src/main.ts --port 8081 --things counter:2 --models-dir /home/<user>/wot-lab/shared/thing-models
User=<user>
Restart=always
RestartSec=30
Type=simple

[Install]
WantedBy=multi-user.target
```