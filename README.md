# WoT Lab

> A Web of Things (WoT) development framework for rapid IoT device prototyping and testing.

WoT Lab creates a new Thing from a folder of convention-named files:

- **Thing Description** (`.td.json`) — capabilities in W3C WoT format. **Required.**
- **State** (`state.json`) — initial property values / device state. **Required.**
- **Logic** (`logic.js`) — imperative behavior and interaction handlers. **Optional.**
- **Effects** (`vre:effects` in action affordances) — declarative action effects in the VRE language. **Optional.**

A Thing needs only its TD and state; behavior can come from `logic.js`, a `.vre` file, or both. With neither, default property read handlers are generated from the TD so the Thing is still observable. See [Creating Things](#creating-things) for detailed examples.

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [Features](#features)
- [Configuration](#configuration)
- [Creating Things](#creating-things)
- [API Reference](#api-reference)
- [Examples](#examples)
- [Debug Logging](#debug-logging)

## Overview

WoT Lab provides a simplified development environment for creating virtual **Web of Things** - devices that follow W3C Web of Things standards.

## Quick Start

```bash
# Install dependencies
bun install

# Run in auto-discovery mode (loads all Things)
bun run dev

# Or specify which Things to run
bun run dev -- --things counter:2,lamp:1
```

The WoT servient serves Thing Descriptions at `http://localhost:8081/`.

## Features

### State Management

WoT Lab provides two ways to interact with your IoT Things:

1. **Global State Tracking**: All Thing states tracked in [`globalState`](./src/globalState.ts#L10) using [Valtio proxies](https://valtio.dev/docs/api/basic/proxy) for reactivity (in-process only)

2. **WoT Protocol**: Standard Web of Things interaction patterns via Thing Descriptions served by `@node-wot`

## Configuration

Configure which Things to run and how many instances to create:

### 1. Configuration File (`wot-config.json`)

```json
{
  "things": {
    "counter": { "instances": 3 },
    "lamp": { 
      "instances": 2,
      "idPrefix": "light"
    }
  },
  "global": {
    "wotPort": 8081
  }
}
```

**Options:**
- `instances`: Number of instances to create
- `idPrefix`: Custom prefix for instance IDs (optional, defaults to Thing name)

### 2. Command Line Arguments

```bash
bun run dev -- --things counter:3,lamp:2
```

### 3. Auto-Discovery (Default)

If no configuration is provided, WoT Lab automatically discovers and loads one instance of each Thing type.

**Instance ID Generation:**
- Multiple instances: `counter-1`, `counter-2`, `counter-3`
- Single instances: `lamp`
- Custom prefixes: `"idPrefix": "light"` creates `light-1`, `light-2`

## Creating Things

### Overview

A Thing is a dedicated folder containing:

1. **Thing Description** (TD) — JSON file describing capabilities. **Required.**
2. **State** — JSON object defining initial properties. **Required.**
3. **Logic** — JavaScript code defining behavior. **Optional.**
4. **Effects** — a `.vre` file declaring action effects (see [VRE](#4-effects-mydevicevre-optional)). **Optional.**

Provide behavior with `logic.js`, a `.vre` file, or both. With neither, WoT Lab generates default property read handlers from the TD so the Thing's state is still readable/observable.

### Folder Structure

To add a new Thing called `mydevice`:

```
src/things/mydevice/
├── mydevice.td.json    # Thing Description   (required)
├── state.json          # Initial state       (required)
├── logic.js            # Imperative behavior  (optional)
└── mydevice.vre        # Declarative effects  (optional)
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

JavaScript code with handler functions and helpers. It is read as text and evaluated in a sandbox where `thing`, `state`, `http`, `URL`, and `createLoggers` are available (no imports needed):

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

#### 4. Effects (`mydevice.vre`) — optional

Instead of (or alongside) hand-written action handlers, action behavior can be declared in a `.vre` file using **VRE**, the V-Realm effect language. A VRE program contains optional `const name = <URI>;` bindings followed by primed property assignments (`property' = expr`). VRE does not declare actions or contain permission guards. WoT Lab associates each effect section with an action using a comment header:

```
// mydevice.vre
const myDevice = <urn:wot:mydevice>;

// toggle():
myDevice.status' = !myDevice.status;
```

- **Effects** `property' = expr` compile to a state assignment plus a property-change notification (so the change is observable). The right-hand side supports arithmetic, boolean/comparison operators, and `[]`/`append`/`remove`.
- **Action sections** use `// action(param1, param2):` headers. A file without section headers is supported when the TD declares exactly one action.
- **References**: a bare identifier that names one of the action's input parameters resolves to that input value; otherwise it resolves to a Thing property. Effect targets (left of `'`) must be Thing properties.

A Thing declared with only a TD, `state.json`, and a `.vre` file needs no `logic.js` at all — see [`src/things/vswitch/`](./src/things/vswitch/) and [`src/things/lamp/`](./src/things/lamp/) for complete examples.

## API Reference

WoT Lab exposes one HTTP server from `@node-wot/binding-http`. It listens on port `8081` by default; set `global.wotPort` in `wot-config.json` to change it. There is no separate REST API, state endpoint, or port-4000 server. The Thing Description is the source of truth for the affordances and payload schemas available for each Thing.

The root path is content-negotiated: request `Accept: application/json` for a machine-readable list of Things, or `Accept: text/html` for a browsable directory. A Thing path requested with `Accept: text/html` shows links for its Thing Description, properties, observations, actions, and events. Requests with other `Accept` values continue to the standard WoT routes below.

### Endpoint shapes

Replace `{thingId}` with the exposed instance ID (for example, `counter`, `counter-1`, or a configured `idPrefix`). Use the `forms` in the returned Thing Description when a Thing uses URI variables or a non-default content type.

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

### Included Thing affordances

This is the endpoint inventory for the Things shipped in `src/things/`. Every listed property has an individual read endpoint. Every listed action has an individual invoke endpoint, and every listed event has an individual subscription endpoint.

| Thing ID | Properties | Actions | Events |
|----------|------------|---------|--------|
| `blergb` | `currentColor`, `power`, `currentEffect`, `brightness`, `lastUpdated` | `setColor`, `setPower`, `setEffect`, `setBrightness` | `colorChanged`, `powerChanged`, `effectChanged` |
| `brightness` | `brightness`, `lastUpdated` | None | None |
| `counter` | `count` | `increment`, `decrement`, `reset` | `change` |
| `door` | `locked`, `lockState`, `batteryLevel`, `lastAction` | `lock`, `unlock` | `lockStateChanged`, `unauthorizedAccess` |
| `lamp` | `on`, `brightness` | `toggle`, `setBrightness` | None |
| `motion` | `motionDetected`, `lastMotion`, `activityLevel` | None | `motion`, `noMotion` |
| `presence` | `isPresent`, `lastDetection`, `detectionCount` | None | `presence`, `absence` |
| `ruuvitag` | `temperature`, `humidity`, `pressure`, `acceleration`, `batteryInfo`, `movementCounter`, `sequenceNumber`, `lastUpdated` | `simulateReading` | `sensorData`, `movementDetected` |
| `thermometer` | `temperature`, `lastUpdated` | None | None |
| `vswitch` | `level` | `setLevel` | None |

For example, these requests read a TD, read a property, and invoke a no-input action:

```bash
curl http://localhost:8081/counter
curl http://localhost:8081/counter/properties/count
curl -X POST http://localhost:8081/counter/actions/increment
```

Use a WoT client for observation, event subscriptions, and action inputs. The repository includes clients under `src/things/<name>/exampleClient.ts`, runnable through the `*client` scripts.

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

### Running Examples

```bash
# Run brightness sensor client
bun run brightnessclient

# Run counter client
bun run counterclient

# Run lamp client  
bun run lampclient

# Run presence sensor client (tests WoT properties and events)
bun run presenceclient

# Run RuuviTag sensor client (comprehensive environmental sensor)
bun run ruuviclient

# Run BLE RGB Controller client (LED color control)
bun run blergbclient
```

## Debug Logging

WoT Lab uses the [`debug`](https://www.npmjs.com/package/debug) package for structured logging with hierarchical namespaces.

### Debug Namespaces

| Namespace | Description | What it logs |
|-----------|-------------|--------------|
| `wot-lab:system:*` | Main application | Startup, shutdown, creation summaries |
| `wot-lab:config:*` | Configuration | Config loading, CLI parsing, auto-discovery |
| `wot-lab:things:*` | Thing management | Thing creation, instantiation, exposure |
| `wot-lab:state:*` | State management | Global state changes, Thing state updates |
| `wot-lab:simulation:*` | Device simulation | Device actions, sensor readings |

### Using Debug Logging

**Pre-configured scripts:**

```bash
bun run dev:debug              # Enable all wot-lab debug logging
bun run dev:debug:core         # System, config, and things only
bun run dev:debug:simulation   # Device simulation only
```

**Manual debug configuration:**

```bash
# Enable all wot-lab logging
DEBUG=wot-lab:* bun run dev

# Enable specific namespaces and log levels
DEBUG=wot-lab:system:debug,wot-lab:things:info bun run dev

# Enable all simulation logging for specific devices
DEBUG=wot-lab:simulation:brightness:*,wot-lab:simulation:ruuvitag:* bun run dev

# System startup logging (default); disable it with DEBUG=none
bun run dev
```

## Development Scripts

### Available Commands

```bash
# Development
bun run dev              # Auto-discovery mode (loads all Things)
bun run dev:debug        # Development with full debug logging enabled
bun run dev:debug:core   # Development with core system debugging (system, config, things)
bun run dev:debug:simulation # Development with simulation debugging only
bun run dev:config       # Using configuration file
bun run dev:cli          # Using command line arguments
bun run dev -- --things counter:2,lamp:1  # Manual CLI specification

# Production / type-check
bun run build           # Type-check (tsc --noEmit)
bun start              # Run the app (bun src/main.ts)

# Examples
bun run brightnessclient # Run brightness sensor example client
bun run counterclient   # Run counter example client
bun run lampclient     # Run lamp example client
bun run presenceclient # Run presence sensor example client
bun run ruuviclient    # Run RuuviTag sensor example client
bun run blergbclient   # Run BLE RGB Controller example client
```

### Development Workflow

1. **Create your Thing** (a TD + `state.json`, plus optional `logic.js` and/or a `.vre` effect file)
2. **Test locally** with `bun run dev`
3. **WoT protocol access** at `http://localhost:8081/` (fetch Thing Descriptions, interact via a WoT client)
4. **Type-check and run** with `bun run build && bun start`

---

**Need help?** Check the existing examples in `src/things/` or fetch a Thing Description from `http://localhost:8081/` when running.