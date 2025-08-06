# WoT Lab

> A Web of Things (WoT) development framework for rapid IoT device prototyping and testing.

WoT Lab uses a **3-file convention** for creating new Things:

- **Thing Description** (`.td.json`) - Defines capabilities in W3C WoT format
- **State** (`state.json`) - Initial property values / device state  
- **Logic** (`logic.js`) - Behavior implementation and interaction handlers

See [Creating Things](#creating-things) for detailed examples.

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
npm install

# Run in auto-discovery mode (loads all Things)
npm run dev

# Or specify which Things to run
npm run dev -- --things counter:2,lamp:1
```

Visit `http://localhost:3000/api/v1/` to access the Simulation API.

## Features

### 🏗️ Quick Thing Creation

WoT Lab uses a **3-file convention** for creating new Things:

- **Thing Description** (`.td.json`) - Defines capabilities in Thing Description format
- **State** (`state.js`) - Initial property values and device state  
- **Logic** (`logic.js`) - Behavior implementation and interaction handlers

See [Creating Things](#creating-things) for detailed examples.

### 📊 State Management & Simulation

WoT Lab provides multiple ways to interact with your IoT Things:

1. **Global State Tracking**: All Thing states tracked in [`globalState`](./src/globalState.ts#L10) using [Valtio proxies](https://valtio.dev/docs/api/basic/proxy) for reactivity

2. **Simulation API**: Single HTTP endpoint at [`StateRestAPI`](./src/StateRestAPI.ts) for both monitoring and simulation:
   - **State monitoring**: `GET /api/v1/states` - View all current states
   - **Property validation**: `GET /api/v1/check/:thingId/:property/:value` - Test conditions  
   - **Environment simulation**: `PUT/POST /api/v1/things/:thingId/*` - Control device behavior

3. **WoT Protocol**: Standard Web of Things interaction patterns via Thing Descriptions

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
    "apiPort": 3000,
    "wotPort": 8081
  }
}
```

**Options:**
- `instances`: Number of instances to create
- `idPrefix`: Custom prefix for instance IDs (optional, defaults to Thing name)

### 2. Command Line Arguments

```bash
npm run dev -- --things counter:3,lamp:2
```

### 3. Auto-Discovery (Default)

If no configuration is provided, WoT Lab automatically discovers and loads one instance of each Thing type.

**Instance ID Generation:**
- Multiple instances: `counter-1`, `counter-2`, `counter-3`
- Single instances: `lamp`
- Custom prefixes: `"idPrefix": "light"` creates `light-1`, `light-2`

## Creating Things

### Overview

Adding a new Thing requires **3 files** in a dedicated folder:

1. **Thing Description** (TD) - JSON file describing capabilities
2. **State** - JSON object defining properties
3. **Logic** - JavaScript code defining behavior

### Folder Structure

To add a new Thing called `mydevice`:

```
src/things/mydevice/
├── mydevice.td.json    # Thing Description
├── state.json          # Initial state object
└── logic.js            # Behavior implementation
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

#### 3. Logic (`logic.js`)

JavaScript code with handler functions and helpers. Built-in Node.js modules (`http`, `URL`) are available:

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

// Optional: Register simulation endpoints with the API
const thingId = thing.getThingDescription().id?.replace('urn:wot:', '') || 'mydevice';

registerThingEndpoint(thingId, 'GET', '/status', (req, res) => {
  res.json({
    success: true,
    data: { status: state.status, lastUpdated: state.lastUpdated }
  });
});

registerThingEndpoint(thingId, 'POST', '/toggle', (req, res) => {
  state.status = !state.status;
  state.lastUpdated = new Date().toISOString();
  thing.emitPropertyChange("status");
  thing.emitPropertyChange("lastUpdated");
  
  res.json({
    success: true,
    message: "Status toggled",
    data: { status: state.status, lastUpdated: state.lastUpdated }
  });
});

console.log(`📡 ${thingId} simulation endpoints registered`);
```

## API Reference

### Simulation API

Base URL: `http://localhost:3000/api/v1/`

#### State Monitoring Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | API documentation and info |
| GET | `/tracked` | List of tracked Things |
| GET | `/states` | All current states |
| GET | `/states/:thingId` | Specific Thing state |
| GET | `/check/:thingId/:property/:expectedValue` | Check property value |
| POST | `/check/:thingId` | Batch check multiple properties |

#### Thing Simulation Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/things/:thingId/endpoints` | Get available simulation endpoints for a thing |
| ALL | `/things/:thingId/*` | Thing-specific simulation endpoints |

**Examples:**
- `GET /things/brightness/brightness` - Read brightness sensor value
- `PUT /things/brightness/brightness` - Set brightness sensor value
- `GET /things/presence/presence` - Trigger presence detection
- `GET /things/presence/status` - Get presence sensor status

### Example API Usage

#### State Monitoring
```bash
# Get all states
curl http://localhost:3000/api/v1/states

# Get specific Thing state
curl http://localhost:3000/api/v1/states/counter-1

# Check if counter value equals 5
curl http://localhost:3000/api/v1/check/counter-1/count/5

# Batch check multiple properties
curl -X POST http://localhost:3000/api/v1/check/lamp-1 \
  -H "Content-Type: application/json" \
  -d '{"on": true, "brightness": 75}'
```

#### Environment Simulation
```bash
# Get available endpoints for a thing
curl http://localhost:3000/api/v1/things/brightness/endpoints

# Simulate brightness sensor readings
curl http://localhost:3000/api/v1/things/brightness/brightness
curl -X PUT http://localhost:3000/api/v1/things/brightness/brightness \
  -H "Content-Type: application/json" \
  -d '{"brightness": 1500}'

# Simulate presence detection
curl http://localhost:3000/api/v1/things/presence/presence
curl http://localhost:3000/api/v1/things/presence/absence
curl http://localhost:3000/api/v1/things/presence/status

# Simulate RuuviTag sensor readings
curl http://localhost:3000/api/v1/things/ruuvitag/data
curl -X POST http://localhost:3000/api/v1/things/ruuvitag/simulate \
  -H "Content-Type: application/json" \
  -d '{"temperature": 22.5, "humidity": 65, "movement": false}'
curl -X POST http://localhost:3000/api/v1/things/ruuvitag/movement

# Control BLE RGB LED
curl http://localhost:3000/api/v1/things/blergb/status
curl -X POST http://localhost:3000/api/v1/things/blergb/color \
  -H "Content-Type: application/json" \
  -d '{"R": 255, "G": 128, "B": 0}'
curl -X POST http://localhost:3000/api/v1/things/blergb/power \
  -H "Content-Type: application/json" \
  -d '{"state": true}'
curl http://localhost:3000/api/v1/things/blergb/color/255/0/255
```

## Examples

### Included Things

WoT Lab comes with example Things:

#### Brightness Sensor
- **Properties**: `brightness`, `lastUpdated`
- **Features**: Environmental light level monitoring in lux (0-100,000), read-only sensor

#### Counter
- **Properties**: `count`, `lastChange`
- **Actions**: `increment`, `decrement`, `reset`
- **Features**: Supports step parameter via URI variables

#### Lamp  
- **Properties**: `on`, `brightness`
- **Actions**: `toggle`, `setBrightness`
- **Features**: Brightness validation, state-dependent actions

#### Presence Sensor
- **Properties**: `isPresent`, `lastDetection`, `detectionCount`
- **Events**: `presence`, `absence` (with timestamps and metadata)
- **Simulation Endpoints**: GET endpoints at `/presence`, `/absence`, `/status`
- **Features**: Dual interface (WoT + HTTP), duration tracking, real-time events

#### RuuviTag Sensor
- **Properties**: `temperature`, `humidity`, `pressure`, `acceleration`, `batteryInfo`, `movementCounter`, `sequenceNumber`
- **Events**: `sensorData`, `movementDetected` (with comprehensive sensor data)
- **Actions**: `simulateReading` (with optional parameters for temperature, humidity, movement)
- **Simulation Endpoints**: GET `/data`, POST `/simulate`, POST `/movement`
- **Features**: Multi-sensor environmental monitoring, movement detection, automatic data simulation every 10s

#### BLE RGB Controller
- **Properties**: `currentColor`, `power`, `currentEffect`, `brightness`, `lastUpdated`
- **Events**: `colorChanged`, `powerChanged`, `effectChanged` (with timestamps and command data)
- **Actions**: `setColor`, `setPower`, `setEffect`, `setBrightness` (full LED control)
- **Simulation Endpoints**: GET `/status`, POST `/color`, POST `/power`, POST `/effect`, POST `/brightness`, GET `/color/:r/:g/:b`
- **Features**: RGB LED control with BLE command simulation, brightness adjustment, URL-based color setting

### Running Examples

```bash
# Run brightness sensor client
npm run brightnessclient

# Run counter client
npm run counterclient

# Run lamp client  
npm run lampclient

# Run presence sensor client (tests both WoT and HTTP interfaces)
npm run presenceclient

# Run RuuviTag sensor client (comprehensive environmental sensor)
npm run ruuviclient

# Run BLE RGB Controller client (LED color control)
npm run blergbclient
```

## Debug Logging

WoT Lab uses the [`debug`](https://www.npmjs.com/package/debug) package for structured logging with hierarchical namespaces.

### Debug Namespaces

| Namespace | Description | What it logs |
|-----------|-------------|--------------|
| `wot-lab:system:*` | Main application | Startup, shutdown, creation summaries |
| `wot-lab:config:*` | Configuration | Config loading, CLI parsing, auto-discovery |
| `wot-lab:things:*` | Thing management | Thing creation, instantiation, exposure |
| `wot-lab:http:*` | HTTP operations | Server startup, endpoint registration |
| `wot-lab:state:*` | State management | Global state changes, Thing state updates |
| `wot-lab:simulation:*` | Device simulation | Device actions, sensor readings, endpoint activity |

### Using Debug Logging

**Pre-configured scripts:**

```bash
npm run dev:debug              # Enable all wot-lab debug logging
npm run dev:debug:core         # System, config, and things only
npm run dev:debug:http         # HTTP operations only  
npm run dev:debug:simulation   # Device simulation only
```

**Manual debug configuration:**

```bash
# Enable all wot-lab logging
DEBUG=wot-lab:* npm run dev

# Enable specific namespaces and log levels
DEBUG=wot-lab:system:debug,wot-lab:things:info npm run dev

# Enable all simulation logging for specific devices
DEBUG=wot-lab:simulation:brightness:*,wot-lab:simulation:ruuvitag:* npm run dev

# Disable debug logging (default)
npm run dev
```

## Development Scripts

### Available Commands

```bash
# Development
npm run dev              # Auto-discovery mode (loads all Things)
npm run dev:debug        # Development with full debug logging enabled
npm run dev:debug:core   # Development with core system debugging (system, config, things)
npm run dev:debug:http   # Development with HTTP debugging only
npm run dev:debug:simulation # Development with simulation debugging only
npm run dev:config       # Using configuration file
npm run dev:cli          # Using command line arguments
npm run dev -- --things counter:2,lamp:1  # Manual CLI specification

# Production
npm run build           # Build TypeScript
npm start              # Run production build

# Examples
npm run brightnessclient # Run brightness sensor example client
npm run counterclient   # Run counter example client
npm run lampclient     # Run lamp example client
npm run presenceclient # Run presence sensor example client
npm run ruuviclient    # Run RuuviTag sensor example client
npm run blergbclient   # Run BLE RGB Controller example client

# API only
npm run api            # Run only the REST API server
```

### Development Workflow

1. **Create your Thing** following the 3-file convention
2. **Test locally** with `npm run dev`
3. **Monitor states** via simulation API at `http://localhost:3000/api/v1/states`
4. **Simulate environment** via simulation API at `http://localhost:3000/api/v1/things/`
5. **WoT protocol access** at `http://localhost:8081/`
6. **Build and deploy** with `npm run build && npm start`

---

**Need help?** Check the existing examples in `src/things/` or explore the simulation API at `http://localhost:3000/api/v1/` when running.