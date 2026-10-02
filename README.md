# WoT-Lab

> Reusable Web of Things environments and goal-directed tasks for evaluating service-consuming agents.

WoT-Lab is a benchmark for service-consuming agents, and the framework that runs it. Every service is a W3C **Web of Things** *Thing* served over the standard WoT HTTP protocol; each **Action** in its **Thing Description** carries an executable *effect specification*, so the description an agent fetches is also what runs. Things, environments, and tasks are authored **as data, not code**.

A Thing is a folder of convention-named files:

- **Thing Description** (`.td.json`) - Properties, Actions and Events in W3C WoT format, each Action's effect declared inline. **Required.**
- **State** (`state.json`) - initial Property values. **Required.**
- **Effects** (`vre:effects` on an Action) - the declarative effect specification, written in VRE. **Optional.**
- **Logic** (`logic.js`) - imperative behavior, for the little that a declarative effect cannot express. **Optional.**

A Thing needs only its Thing Description and state; behavior can come from `vre:effects` specifications, `logic.js`, or both. With neither, Property handlers are generated from the Thing Description - reads for every Property, writes for the ones it does not mark `readOnly` - so the Thing is usable without any code. See [Creating Things](#creating-things) for detailed examples.

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [Features](#features)
- [Configuration](#configuration)
- [Creating Things](#creating-things)
- [Publishing provenance to a Solid pod](#publishing-provenance-to-a-solid-pod)
- [Building what a Solid pod orders](#building-what-a-solid-pod-orders)
- [API Reference](#api-reference)
- [Security](#security)
- [Examples](#examples)

## Overview

Each service is a virtual **Web of Things** Thing served over the standard WoT HTTP protocol, so an agent interacts with it exactly as it would a real device - fetching its Thing Description, reading Properties, invoking Actions. An Action's effect is declared in the Thing Description and executed from there, so one file both documents and implements the behaviour, and an environment or task is a JSON artifact rather than a program.

An **environment** is a JSON manifest bundling Things with fixed identifiers and initial state; a **task** is a JSON record of an environment, an instruction, and a goal, scored by the share of its goal predicates the final state satisfies. Six environments and 76 tasks ship; see [Environments](#environments).

## Quick Start

```bash
# Install dependencies
bun install

# Start the lab (no Things running yet - add them in the dashboard)
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
environment and shows how much of the task's goal holds after every step - see
[`tools/README.md`](tools/README.md#run-files-runschemajson) for the file format.

### State Management

WoT-Lab provides two ways to interact with your IoT Things:

1. **Global State Tracking**: All Thing states tracked in [`globalState`](./src/globalState.ts#L10) using [Valtio proxies](https://valtio.dev/docs/api/basic/proxy) for reactivity (in-process only)

2. **WoT Protocol**: Standard Web of Things interaction patterns via Thing Descriptions served by `@node-wot`

3. **Solid pod** (opt-in): with `--solid-container`, every interaction with a Thing posts a PROV-O
   record - the request, who made it, and the whole environment's state it left behind - to an LDP
   container as RDF, and every finished product with the products it links - see [Publishing provenance to a Solid pod](#publishing-provenance-to-a-solid-pod)

## Configuration

### Command line

```bash
bun run dev -- --things counter:3,lamp    # 3 counters and 1 lamp
bun run dev -- --env e-commerce           # a whole scenario in one command
bun run dev -- --port 9000                # or WOT_LAB_PORT=9000
```

- `--things <model>[:<count>],...` - Things to start, named by the Thing Model they
  are built from. The count is optional and defaults to 1. Omit the flag entirely
  to start empty.
- `--env <name>` - an [environment](#environments) to bring online: a named
  bundle of Thing Models with fixed instance ids and initial state (or
  `WOT_LAB_ENV`).
- `--port <number>` - HTTP port. Defaults to `8081`, or `WOT_LAB_PORT`.
- `--models-dir <path>` - where Thing Models authored in the dashboard are
  written (or `WOT_LAB_MODELS_DIR`). Unset, they are written alongside the
  bundled ones in `src/things/`.
- `--solid-container <url>` - an LDP container (a Solid pod's, typically) the lab
  works against: `traces/` gets a PROV-O record of every interaction, `products/`
  every finished product and the products it links, and `orders/` is read for
  smartphones to build (or `WOT_LAB_SOLID_CONTAINER`). Unset, nothing is posted,
  nothing is read and the lab makes no outbound requests - see
  [Publishing provenance to a Solid pod](#publishing-provenance-to-a-solid-pod)
  and [Building what a Solid pod orders](#building-what-a-solid-pod-orders).
- `--agent-header <name>` - the request header a client names itself in, reported
  as the activity's agent (or `WOT_LAB_AGENT_HEADER`). Defaults to `X-Agent`; a
  request naming no agent is attributed to the address it came from. 
- `--orders-poll <seconds>` - how often the pod's `orders/` container is read (or
  `WOT_LAB_ORDERS_POLL`). Defaults to 5; `0` leaves orders unread, for a lab that
  is to write records and nothing else.


## Creating Things

### Overview

A Thing Model is a dedicated directory in `src/things/`. **Add Thing** in the dashboard
writes exactly the files described below, so you can add them via the dashboard or by hand.

A Thing Model directory contains:

1. **Thing Description** (TD) - JSON file describing capabilities. With `vre:effects`, describing the Thing's behavior. **Required.**
2. **State** - JSON object defining initial properties. **Required.**
3. **Logic** - JavaScript code defining behavior. **Optional.**

Provide behavior with `logic.js`, `vre:effects` annotations, or both. With neither, WoT-Lab generates property handlers from the TD: a read handler for every property, and a write handler for each one not marked `readOnly`, so a writable property can actually be set. The Thing's state is readable, writable and observable without a line of code.

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

#### 3. Logic (`logic.js`) - optional

JavaScript code with handler functions and helpers. It is read as text and `eval`'d with `thing`, `state`, `http`, `URL`, and `createLoggers` in scope (no imports needed).

> **`logic.js` is trusted code, not a sandbox.** It runs inside the lab's process with the lab's
> privileges - it can read files, open sockets and reach anything the process can. Only start
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

#### 4. Effects (`vre:effects`) - optional

An Action's effect specification is declared on the affordance itself, so the
Thing Description the agent fetches is also what executes: behaviour read is
behaviour met. The specification is written in **VRE**, the declarative effect
language, in a `vre:effects` annotation, and needs no hand-written handler:

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
  pre-state snapshot, then all effects apply at once - so an effect can read a
  value another effect in the same action overwrites (V-Realm's flat effects).
- **Pre/post references**: in expressions, an unprimed reference is the
  **pre-state** value and a primed reference (`x'`) is the **post-state** value;
  primes are not allowed on the right-hand side of an effect. (That is why the
  `toggle` example emits `status'` - the new value.)
- **References**: a bare identifier naming one of the action's input parameters
  resolves to that input; otherwise it resolves to a Thing property. Effect
  targets (left of `'`) must be Thing properties. `this.id` is the running
  instance's own id.
- **Cross-Thing effects**: a dotted `handle.prop` (as a target or a value) names
  a property on *another* Thing, where `handle` is a static binding
  (`const bank = <bank-id>`), an action input parameter carrying a Thing
  reference, or a Thing property whose value is a Thing reference (so one shared
  model can target a per-instance device - a plug's `device.poweredOn'`).
  Everything is in-process - the write lands on the other Thing's state and fires
  its change notification, no remote call. Used for the bank
  `transfer`, cart `checkout`, warehouse `orderStock`/`transferStock`, and the
  social follow/like effects (see [Environments](#environments)).
- **Outputs**: `output.<path> = expr` (nested paths allowed) builds the action's
  return value, evaluated after effects apply. Behaviour VRE cannot express
  (array lookups, sums, object construction) stays in `logic.js`, which composes
  with `vre:effects`.
- **No functions**: an effect reads the Thing's state and the action's input and
  nothing else - no time, no calls - so a run is reproducible from its initial
  state alone. Behaviour that needs more belongs in `logic.js`.
- **Input parameters**: an object `input` schema exposes each of its properties
  by name; a scalar `input` is referred to as `input`.
- **Events** are emitted with `emitEvent("name", value)`.


## Publishing provenance to a Solid pod

Point the lab at an LDP container and every WoT interaction with a Thing publishes
its provenance there, as one Turtle resource per interaction: the request that
arrived, the activity that handled it, and the state that activity left behind -
the whole environment's state, every Property of every running Thing.

```bash
bun run dev -- --env smart-home --solid-container https://solid.example.org/alice/wot-lab/
```

The container holds three of its own, which the lab creates:

```
wot-lab/
├── traces/000007/    one record per interaction, in order
├── products/000007/  each finished product and every product it links
└── orders/           smartphones to build; the lab reads this one
```

`000007` is the **serial number** of the phone that run built, so a reader holding
a phone can find its history from the number on its back. See
[Serial numbers](#serial-numbers).

A run is one build: the environment plus the moment it was last put into its initial
conditions - brought up, or reset by `POST /_lab/reset`. A reset counts because a
run is a sequence of interactions from a known starting state, and that is what a
reset re-establishes: without it, two replays of a task, or two orders of a
session, would share one run, their records would read as one sequence, and the
resources they both write would overwrite each other - a product has the same id
every time it is made.

A product counts as finished
when its model or manifest types it `ex:Smartphone`; when an Action produces one,
the lab writes its Turtle representation and those of its battery and raw inputs
beside it, so its relative links resolve inside the pod. Each carries the serial of
the item it is, links back to the run's traces with `ex:trace`, and says when it was
made with `prov:generatedAtTime` - the interaction that brought it into existence, so
a phone and the battery inside it carry the two different moments they were built
rather than the one moment their documents were written:

```turtle
<#product>
    a                      arena:Product, ex:Smartphone ;
    schema:name            "smartphone" ;
    schema:serialNumber    "000007" ;
    prov:generatedAtTime   "2023-09-14T09:30:00.576Z"^^xsd:dateTime ;
    ex:trace               <https://solid.example.org/alice/wot-lab/traces/000007/> ;
    ex:battery             <f5batt-1zw-ww1#product> ;
    ex:input               <glass#product> , <lcd#product> .
```

A raw material carries no time: it was on the floor before the run began, and the
lab did not see it made. Neither does a product in a lab with no container
configured, which observes no production at all - so the `GET /products/<id>` the
lab serves itself carries the time exactly when the pod's copy of it would.

### Serial numbers

A build makes one finished product, so a build and a serial are the same thing
counted two ways: the serial names the phone that came out of the run, and it names
the two containers holding how that phone came to be.

Every part written beside the phone gets a serial of its own, derived from the
build's - two items must not share a serial, and a battery is not the phone it went
into, but it *is* that phone's battery and a serial saying so is worth more than an
unrelated number:

| Document | `schema:serialNumber` |
|---|---|
| `products/000007/smartphone` | `000007` - the build is for it, so it takes the serial unsuffixed |
| `products/000007/f5batt-1zw-ww1` | `000007-001` |
| `products/000007/glass` | `000007-013` |

Parts are numbered in the order the phone links them, which is the order the
documents go to the pod: the battery and the raw inputs at the end of each recipe
chain. `schema:serialNumber` is schema.org's own term for the identifier of one
manufactured item, as against the `schema:name` every item of that kind shares - and
a passport already speaks schema.org for `mpn` and `model`.

Serials are allocated in order, six digits wide so a pod's listing sorts in build
order, and **continue past whatever the pod already holds**. The lab reads
`products/` once at startup and resumes from the highest serial in it, which is what
makes them safe across restarts: the timestamps they replace were unique by
construction, while a counter beginning at one every time the lab came up would have
the second session overwrite the first session's traces and products. A pod that
grants append but not read cannot be listed, so the count starts at one and the lab
says so in a warning.

Gaps are normal. A serial is spent when a run begins, so a run that is reset without
building anything leaves its number unused - the sequence says what order builds
happened in, not that every number names a phone. A container the lab did not name -
left by hand, or by the timestamp scheme this replaced - is not a serial and is not
counted past.

`orders/` is the one container the lab reads rather than writes - see
[Building what a Solid pod orders](#building-what-a-solid-pod-orders).

The container is the only required configuration, and without it nothing is posted:
the default lab makes no outbound requests. Requests are unauthenticated, so the
container has to grant append to the public; the lab sends no credentials.

### What is posted, and when

One record per **affordance** request - a Property read or write, an Action
invocation, a Property observation, an Event subscription - written after the
response has been written, so the state it reports is the state the request
produced. A Thing Description fetch records nothing (it reads no state), nor do the
dashboard, its assets, or the [lab API](#lab-api-_lab). A long-poll observation
the client abandons records nothing either: it changed nothing.

A `PUT` to a URI the lab chose, not a `POST` for the pod to name: a record has to
name the record before it, and a pod-minted name is not known until that POST
returns, so a chain built from those would either be wrong or would make every write
wait for the one before it. The name is the record's position in its run, zero-padded
and followed by the Thing - `00000617-glue1` - so the listing a pod gives for free
reads in the order the interactions happened, which `10` before `9` would spoil. A
pod that will not take the run's container is not worth losing records over: those
fall back to a `POST` into the flat `traces/`, with a `Slug` naming the Thing and the
time.

A refused interaction is recorded like any other, with its status on the response it
produced and the state it did not change - an agent's rejected write is as much a
part of a run as an accepted one. Only a request naming no running Thing
posts nothing: there is no interaction to report, even though the environment
around it has a state.

The pod is never in the request's path. Records queue in the lab and drain behind
the response down four connections, so a slow or unreachable pod costs a warning
(logged by default; `DEBUG=wot-lab:solid:*` adds every post) and never a slow WoT
response. The queue is bounded at 10,000 records - enough to absorb a scripted
replay firing hundreds of interactions a second; past that, records are dropped
and the drop is logged, because an observer that runs the lab out of memory is
worse than one that misses a reading.

### The resource

```turtle
@prefix rdf:        <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix xsd:        <http://www.w3.org/2001/XMLSchema#> .
@prefix prov:       <http://www.w3.org/ns/prov#> .
@prefix dcterms:    <http://purl.org/dc/terms/> .
@prefix foaf:       <http://xmlns.com/foaf/0.1/> .
@prefix htv:        <http://www.w3.org/2011/http#> .
@prefix httpm:      <http://www.w3.org/2011/http-methods#> .
@prefix httpsc:     <http://www.w3.org/2011/http-statusCodes#> .
@prefix td:         <https://www.w3.org/2019/wot/td#> .
@prefix hctl:       <https://www.w3.org/2019/wot/hypermedia#> .
@prefix cnt:        <http://www.w3.org/2011/content#> .

<>
    a prov:Bundle .

<#request>
    a prov:Entity, htv:Request ;
    htv:mthd httpm:POST ;
    htv:requestURI "http://localhost:8081/lamp/actions/setBrightness" ;
    htv:resp <#response> ;
    dcterms:subject <http://localhost:8081/lamp> ;
    dcterms:conformsTo <#form> ;
    htv:body [ a cnt:ContentAsText ; cnt:chars "{\"level\":40}" ] .

<#response>
    a prov:Entity, htv:Response ;
    htv:sc httpsc:OK .

<#form>
    a hctl:Form ;
    hctl:hasOperationType td:invokeAction .

<#interaction>
    a prov:Activity ;
    prov:wasAssociatedWith <https://pod.example.org/alice/profile/card#me> ;
    prov:used <#request> ;
    prov:generated <#response>, <#state> ;
    prov:startedAtTime "2026-09-30T10:11:29.251Z"^^xsd:dateTime ;
    prov:endedAtTime   "2026-09-30T10:11:29.265Z"^^xsd:dateTime .

<#state>
    a prov:Collection ;
    dcterms:isPartOf <https://solid.example.org/alice/wot-lab/traces/smart-home-2026-09-30T10-10-02-004Z/> ;
    dcterms:isPartOf <http://localhost:8081/_lab/environments/smart-home> ;
    prov:wasRevisionOf <https://solid.example.org/alice/wot-lab/traces/smart-home-2026-09-30T10-10-02-004Z/00000011-lamp#state> ;
    prov:hadMember
        <#state-lamp>,
        <#state-thermostat> .

<#state-lamp>
    a prov:Dictionary ;
    prov:specializationOf <http://localhost:8081/lamp> ;
    prov:hadDictionaryMember
        [ prov:pairKey "poweredOn" ; prov:pairEntity [ prov:value true ] ] ,
        [ prov:pairKey "brightness" ; prov:pairEntity [ prov:value 40 ] ] ,
        [ prov:pairKey "colour" ; prov:pairEntity <#value-10373ae2e2ce3496> ] .

<#state-thermostat>
    a prov:Dictionary ;
    prov:specializationOf <http://localhost:8081/thermostat> ;
    prov:hadDictionaryMember
        [ prov:pairKey "target" ; prov:pairEntity [ prov:value 21 ] ] .

<#value-10373ae2e2ce3496>
    a prov:Dictionary ;
    prov:hadDictionaryMember
        [ prov:pairKey "hue" ; prov:pairEntity [ prov:value 36 ] ] ,
        [ prov:pairKey "saturation" ; prov:pairEntity [ prov:value 80 ] ] .
```

Every term is someone else's, so a record needs no documentation but the
specifications it is written in - there is no wot-lab vocabulary to look up:

| What it says | Term | From |
|---|---|---|
| that this document is one record | `prov:Bundle` | [PROV-O](https://www.w3.org/TR/prov-o/) |
| who did it, when, what came out | `prov:Activity`, `prov:used`, `prov:generated`, `prov:startedAtTime`, `prov:endedAtTime` | PROV-O |
| the request and its response | `htv:Request`, `htv:mthd`, `htv:methodName`, `htv:requestURI`, `htv:body`, `htv:resp`, `htv:Response`, `htv:statusCodeValue`, `htv:sc` | [HTTP in RDF](https://www.w3.org/TR/HTTP-in-RDF10/) |
| the body the client sent | `cnt:ContentAsText`, `cnt:chars` | [Content in RDF](https://www.w3.org/TR/Content-in-RDF10/) |
| the WoT operation | `hctl:Form`, `hctl:hasOperationType`, `td:invokeAction` and the other `op` individuals | [WoT TD 1.1](https://www.w3.org/TR/wot-thing-description11/) |
| a state, and one Thing's part of it | `prov:Collection`, `prov:hadMember`, `prov:specializationOf`, `prov:wasRevisionOf` | PROV-O |
| a Property by name, and a structured value's members | `prov:Dictionary`, `prov:hadDictionaryMember`, `prov:pairKey`, `prov:pairEntity`, `prov:value`, `rdf:value` | [PROV-DICTIONARY](https://www.w3.org/TR/prov-dictionary/), [RDF](https://www.w3.org/TR/rdf11-concepts/) |
| identity and names | `foaf:name`, `prov:atLocation`, `dcterms:identifier`, `dcterms:isPartOf`, `dcterms:subject`, `dcterms:conformsTo` | [FOAF](http://xmlns.com/foaf/spec/), [DCMI Terms](https://www.dublincore.org/specifications/dublin-core/dcmi-terms/) |

A record says each fact once. Where a vocabulary has an individual for a value, the
individual is written and the name or code beside it is not: `htv:mthd httpm:POST`
rather than that and `htv:methodName "POST"`, `htv:sc httpsc:OK` rather than that and
`htv:statusCodeValue 200`. A method or a status the vocabulary has no individual for
falls back to the name or the number, which is the fact either way - so a refused
interaction reads `htv:sc httpsc:MethodNotAllowed`, and an extension method reads
`htv:methodName "PROPFIND"`.

The operation is the Thing Description's own IRI for it (`td:invokeAction`, not the
string `"invokeaction"`), hung off a `hctl:Form` because a form is what a TD hangs
it off and `td:` has no Form of its own. The form carries the operation and nothing
else: its target and method are the request's, and `<#request>` says them already.
Which Thing was addressed is `dcterms:subject` on the request, for the same reason -
it is a fact about what arrived, not about the state - and `dcterms:conformsTo`
points at the form the request exercised.

`dcterms:isPartOf` appears twice where both are known: the run's container, which
is what separates two runs of one manifest, and the [environment](#environments)'s
own resource in the [lab API](#lab-api-_lab), so the manifest a run came from is one
hop from any record of it. `prov:wasRevisionOf` is the state this one followed - one
step back rather than a scan of every record's timestamp, and a URI that resolves,
because the lab chose where that record went before writing it.

`<#state>` is the state of the **whole environment**: a `prov:Collection` whose
members are one state per running Thing, in the order the Things were created, each
a `prov:specializationOf` its Thing - the same Thing, as this record found it - and
a `prov:Dictionary` of the Property values the interaction left. A Property is a
`prov:KeyEntityPair`: `prov:pairKey` for the name it is stored under, `prov:pairEntity`
for its value. That is what PROV defines for a named member, which `td:name` and
`jsonschema:propertyName` are not - those name an affordance and a schema, and a
recorded value is neither.

Products are not in there. A product is a resource with a representation of its
own, written to `products/` and linking back to the run, so its state is not
repeated in every record of the run that made it. A mosaik record therefore carries
the environment's 12 Things, not the hundred-odd products on the floor.

Recording every Thing is what makes a cross-Thing `vre:effects` effect legible: a
MOSAIK station's `produce` Action places a new product and consumes the ones it
was built from, none of which is the station. A record of the addressed
Thing alone would show that Action changing nothing. It also means a run reads
back as a sequence of complete states - each record answers "what did the
environment look like at this point", with no need to fold earlier records
together - at the cost of record size, which grows with the environment: a mosaik
record (12 Things) is around 5.6 KB, against 1.8 KB for one Thing, most of which is
the prefix header every record carries.

The subjects are hash URIs of the record itself (`<#request>`, `<#response>`,
`<#interaction>`, `<#form>`, `<#state>`, one `<#state-‹id›>` per Thing and one
`<#value-‹digest›>` per structured value), so one URI is minted and every subject
comes with it - no counter, and no identifier the lab has to keep unique across
restarts. `<>` carries `prov:Bundle`, so a container of records can be filtered to
the records and a reader who merges several has something per record to tell them
apart.

The activity's `prov:startedAtTime` is when the request arrived and
`prov:endedAtTime` when its response finished, which is when the state it generated
came into being - and that is what orders a session, rather than the order the pod
received the records. Neither `<>` nor `<#state>` repeats it as a
`prov:generatedAtTime` of its own: it is the activity's time, and the activity says
it. For an order that asked to have been built in the past, both times are that
order's - see [Ordering a build into the past](#ordering-a-build-into-the-past).

### Who the agent is

A client names itself in a request header - `X-Agent` by default, or whatever
`--agent-header` says:

```bash
curl -X POST -H 'X-Agent: https://pod.example.org/alice/profile/card#me' \
  http://localhost:8081/lamp/actions/toggle
```

A value that is a URI (a WebID, or any `http(s):`/`urn:` IRI) becomes the agent
itself. Anything else - a bare name like `planner-3`, or no header at all, in which
case the address the request came from is all there is to go on - becomes a blank
node, which still says who without minting a URI that nothing would resolve:

```turtle
prov:wasAssociatedWith [ a prov:Agent, foaf:Agent ; foaf:name "planner-3" ] ;
prov:wasAssociatedWith [ a prov:Agent ;
    prov:atLocation [ a prov:Location ; dcterms:identifier "127.0.0.1" ] ] ;
```

A name the client gave itself is a name (`foaf:name`); an address it never gave is
where the request came from, so it is recorded as a location rather than as
something the agent calls itself.

### The request body

`htv:body` records what the client sent, so a log says what was asked for and not
merely that something was asked. The body is read before the Thing is handed the
request - most Actions never look at their input, and a body nobody reads does not
survive the response - and replayed to it unchanged, so recording one cannot change
what a Thing sees.

Recorded are bodies that announce a `Content-Length` of at most 64 KiB, which is
far past any WoT affordance input. A chunked body announces no size and a larger one
is not worth the memory: both stream through untouched and go unrecorded, rather
than partly recorded. A body that is not UTF-8 text is left out too, because a
literal that does not read back as the bytes that arrived is worse than no literal.

### State values

Property values are serialised faithfully, so a record reads back as the state it
recorded:

Each one is a `prov:KeyEntityPair` in its Thing's dictionary - the name it is
stored under and an entity carrying the value:

| State value | Turtle |
|-------------|--------|
| boolean, integer | `[ prov:pairKey "flag" ; prov:pairEntity [ prov:value true ] ]` |
| other number | `[ prov:value "3.5"^^xsd:double ]`, and `"-0"^^xsd:double` for negative zero, which `xsd:integer` has no value for |
| string | `[ prov:value "hello" ]`, or the bare `<https://other.example/thing>` when it reads as an http(s) IRI, so a cross-Thing reference stays followable |
| array | `<#value-‹digest›>`, a `prov:Collection` whose `rdf:value` is an RDF list - ordered, because order carries meaning in a state like a recipe's `inputs`; `prov:EmptyCollection` when there is nothing in it |
| object | `<#value-‹digest›>`, a `prov:Dictionary` of the same pairs; `prov:EmptyDictionary` when there are no members |
| `null` | omitted at predicate position; `[ a prov:Entity ]` inside a list, where dropping it would shift everything after it |

A structured value is **a subject of its own, named by a digest of its contents**,
not a blank node nested where it was found. Two reasons. A blank node is a fresh
identity in every record, so two records holding an unchanged value would disagree
about it and the value would read as having changed in every diff; a digest is the
same fragment in every record that holds that value, so a diff joins on it and an
unchanged value stays silent. And nesting cost a line's indentation per level, which
made a deep value quadratic in its own depth. The digest is not repeated as a
literal - it *is* the fragment the subject is named by.

Two Things sharing a value share the subject, so `recipe` appearing in a station and
in the shopfloor is written once. Past 32 levels deep a value is recorded as present
and not expanded, which bounds what a recursive state can do to a record; a value
JSON cannot canonicalise is written inline rather than shared.

`null` is the one thing no standard vocabulary has a term for. At predicate position
that is no loss: saying nothing *is* how RDF says absent, which is why a product
with no position simply has no `xpos` member. Inside a list the place is held by an
entity that says nothing about itself, which is "an element RDF cannot state" - the
closest a standard vocabulary gets.

### What configuring a container exposes

Two things change when a container is configured. The lab starts making outbound
requests to a host you named, carrying **every Property value of every running
Thing**, not only the one interacted with, the request that reached it - including
its body - and the agent or address behind it, so point it at a container whose contents may be as
public as the container's append permission is. And the resources accumulate: one
per interaction, which a benchmark replay produces by the hundred. Neither the lab
nor the pod prunes them.

A third: whoever can write to `orders/` can make the factory run. See
[Building what a Solid pod orders](#building-what-a-solid-pod-orders).

## Building what a Solid pod orders

A lab pointed at a container reads `orders/` inside it every few seconds and builds
what it finds. This is the replacement for running a fixed plan script by hand: the
plan is still the environment's own, but what it is run *with* comes from the pod.

```bash
bun run dev -- --env mosaik --solid-container https://solid.example.org/alice/wot-lab/
# then put an order in the pod, e.g. one of the examples:
curl -X PUT -H 'Content-Type: text/turtle' \
  --data-binary @orders/order_apple-iphone-16.ttl \
  https://solid.example.org/alice/wot-lab/orders/order-1.ttl
```

### The order

An order is a Turtle document listing the products a smartphone is to be made of,
each named by the **URI the lab serves it at**:

```turtle
@prefix schema: <https://schema.org/> .
@prefix ex:     <https://example.org/passport/> .
@prefix xsd:    <http://www.w3.org/2001/XMLSchema#> .

<#order>
    a                schema:Order ;
    schema:name      "One smartphone with the Apple iPhone 16 battery" ;
    schema:orderDate "2024-09-20T08:15:00.000Z"^^xsd:dateTime ;
    ex:component     <http://localhost:8081/products/661-44796> ,
                     <http://localhost:8081/products/batterycell> ,
                     <http://localhost:8081/products/glass> ,
                     <http://localhost:8081/products/lcd> .
```

What makes a URI a component is that it names a product of *this* lab, so the
predicate carrying it is the order author's choice - `ex:component`,
`schema:orderedItem` or a term of their own all read the same, and a document in
the container that names no product of the lab is not an order and is left alone.
A `.../products/<id>` and a `.../products/<id>#product` name the same product.
One consequence worth knowing: the URIs have to match the port the lab is on, so
the bundled examples under [`orders/`](orders) say `8081` and need editing for a
lab started elsewhere.

Six examples ship, one per phone in `phone resources/` - the same six the plan
scripts under `plans/` were written for, each dated to its own phone's era, so
dropping all six in a pod leaves three years of production rather than six phones
built in the same minute.

### Ordering a build into the past

An order may say **when** it was placed, and the lab builds it now and records it
as having been built then. That is what lets a pod hold a history: the same lab,
the same plan and the same products, run six times, leave six phones made over
three years.

The time is any literal in the order typed `xsd:dateTime` or `xsd:date` - the same
liberty the components are read with, so `schema:orderDate`, `dcterms:created` or a
term of the author's own all read the same. The datatype is what makes that safe to
be liberal about: a date inside a `schema:description` is prose, and prose is not
typed. An order that names several times is dated from the earliest, and says so in
a warning; an order that names none is built as of now.

What moves is every time the lab *claims* about that order's run, shifted by one
offset so the run keeps the length it really had:

| Dated from the order | Left on the clock |
|---|---|
| each record's `prov:startedAtTime` / `prov:endedAtTime` | the [serial](#serial-numbers) the run's containers are named by, which counts builds rather than dating them - so two orders backdated to one instant still get a container each |
| each product's `prov:generatedAtTime` | the lab's logs, the poll loop, every timeout |
| the order's own `ex:fulfilledAt` | |

So a run that took half a second reads as half a second of production on the day
the order asked for:

```turtle
# traces/000001/00000000-t1
<#interaction> prov:endedAtTime "2023-09-14T09:30:00.013Z"^^xsd:dateTime .
# traces/000001/00000617-glue1
<#interaction> prov:endedAtTime "2023-09-14T09:30:00.576Z"^^xsd:dateTime .
```

The date belongs to the **run**, not to the lab: a record that reaches the pod
after the order has finished is still a record of its run and is still dated with
it, and so is an interaction someone fires by hand before anything starts another
run. A reset or the next order begins one, and that run is on the clock again
unless its own order says otherwise.

### Generating a history

[`scripts/generate-history.ts`](scripts/generate-history.ts) puts N dated orders in the
pod, which is all it takes: the lab does the building, numbering and tracing.

```bash
bun run dev -- --env mosaik --solid-container https://solid.example.org/alice/wot-lab/
# then, in another terminal:
bun scripts/generate-history.ts --container https://solid.example.org/alice/wot-lab/ --wait
```

By default that is **150 smartphones spread over the last 3 days**: each of the six
examples under [`orders/`](orders) is a template, picked at random, with its date
replaced. Orders are named `history-0001.ttl`, `history-0002.ttl`, ... in date order,
and the lab builds a container's orders in name order, so serials read
chronologically as well - the phone with serial `000001` is the oldest.

| Option | Default | |
|---|---|---|
| `--container <url>` | `WOT_LAB_SOLID_CONTAINER` | the pod container the lab works against |
| `--count <n>` | `150` | smartphones to generate |
| `--days <n>` | `3` | spread them over the last n days, ending a minute before now |
| `--lab-url <url>` | `http://localhost:8081` | where the lab is served; orders name products by it |
| `--seed <n>` | `1` | the schedule and the choice of phones repeat for a seed |
| `--prefix <name>` | `history` | order file names |
| `--dry-run` | | print the schedule and write nothing |
| `--wait` | | after writing, follow the lab until every order is built |

Credentials are read the way the lab reads them (`WOT_LAB_SOLID_CLIENT_ID` and
`WOT_LAB_SOLID_CLIENT_SECRET`, from the environment or `.env`). An order is only
ever *created*, never overwritten, so running it again skips what is already in the
pod instead of rewinding a built order's marking and having the lab build it twice.

**What 150 phones cost.** Each is a 618-step run, so 150 phones is 92,700 trace
records (about 5.7 KB each, roughly 550 MB) and 2,250 product documents. The lab
builds them one after another and waits for each run's records to reach the pod
before starting the next, so how long it takes is how fast the pod accepts writes:
seconds against a local pod, tens of minutes against a remote one. Without that
wait the lab would outrun the pod and the sink would drop the tail of every run
past its 10,000-record queue.

### How an order is built

The plan is the environment's own: the benchmark task whose goal puts a finished
product (one typed `ex:Smartphone`) on the floor, which for `mosaik` is `s6` and
its 618 steps. Nothing about it is hard-coded here - the task is found by its goal
and the products' own classes.

What the order changes is **which products** the plan's steps name. Every produce
Action takes a parameter per recipe role - each input it consumes and the output it
builds - and each role's `enum` is the set of products that can play it:

```bash
curl -X POST localhost:8081/combine/actions/produceBattery \
  -H 'Content-Type: application/json' \
  -d '{"trigger":"produceIt","batterycell":"batterycell","battery":"661-44796"}'
```

So a product the order names tells the lab which role the order spoke about, and
every other product of that role is replaced by it, in the produce steps and in the
transporter's `pickup` alike. An order that names only a battery gets the plan's own
products for everything else; an order naming a product no recipe uses is built
anyway, with that component logged as unused.

Each order starts from the environment's initial state - the same reset
`POST /_lab/reset` performs - because an order consumes raw materials and the one
after it would otherwise find the floor empty. That reset also makes each order a
**run of its own**, so an order's traces and products get containers no other
order writes into:

```
wot-lab/
├── traces/000001/     order-1: 618 records, starting at 00000000
├── traces/000002/     order-2: its own 618
├── products/000001/   order-1's phone, its battery and its parts
└── products/000002/   order-2's
```

Every invocation carries the order's URI as its agent, so the run's traces say
which order caused them:

```turtle
<#interaction>
    a prov:Activity ;
    prov:wasAssociatedWith <https://solid.example.org/alice/wot-lab/orders/order-1.ttl> .
```

### When an order is done

The lab adds three triples to the order on the pod - that it is done, when it was
done, and what was made for it:

```turtle
<#order>
    <https://example.org/passport/fulfilled>   true ;
    <https://example.org/passport/fulfilledAt> "2023-09-14T09:30:00.580Z"^^xsd:dateTime ;
    <https://example.org/passport/product>
        <https://solid.example.org/alice/wot-lab/products/000001/smartphone> .
```

`fulfilledAt` is when this lab finished building the order, by its run's own clock -
not when the order was placed, which the order itself says. For a backdated order it
is the moment it asked for plus however long the run took. It is taken when the run
ends rather than when the triple lands, so a marking the pod refused and the lab
retried still records when the order was built.

The product link is the pod's copy, not the lab's `/products/smartphone`: the lab
serves whichever phone was made last, so a link there would come to mean a
different phone as soon as the next order was built, while the copy in the pod
belongs to this order's run and keeps saying what this order produced. It is
written from the same interaction that made it, behind the response, so the
document can land a moment after the order says it exists.

A `PATCH` with a SPARQL update, so the document keeps the comments and layout it
was written with; a pod that will not take one is read and written back instead.
An order that already carries the triple is skipped, which is what keeps a restart
from building everything in the container again.

What happens when something goes wrong depends on what went wrong, because the
three cases deserve different answers:

- **The order could not be read** - the pod was busy, a token was being renewed, a
  request timed out. That is no verdict on the order, so it is read again on the
  next sweep. A pod that keeps refusing is reported once, not once per sweep.
- **The pod would not take the triple** - a container that grants append but not
  write cannot. The order is built and stays built; only the *marking* is retried,
  so a refusal never costs a second production run.
- **The plan ran and left no product.** Logged as a warning, not marked, and not
  retried while the lab is up: a plan that cannot run would otherwise run again
  every few seconds.

### Watching it happen

Two lines per order, on by default - no `DEBUG` needed:

```
wot-lab:solid:info Order started: https://…/orders/order-1.ttl — running 618 step(s) of 'mosaik' task s6 with batterycell, 661-44796, ingot, …, dated 2024-09-20T08:15:00.000Z
wot-lab:solid:info Order processed: https://…/orders/order-1.ttl — produced smartphone in 0.4s
```

`DEBUG=wot-lab:solid:*` adds the rest: the sweeps, which documents were not
orders, and every record posted.

## API Reference

WoT-Lab exposes one HTTP server from `@node-wot/binding-http`. It listens on port `8081` by default; use `--port` or `WOT_LAB_PORT` to change it.

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
| One environment | `/_lab/environments/{name}` | `GET` | Its manifest - description, the Things it pins, whether it is the one running. This is the URI a provenance record's `dcterms:isPartOf` points at. `404` for a name no manifest matches. |
| List an environment's tasks | `/_lab/environments/{name}/tasks` | `GET` | The records of its `tasks.json`. |
| Reset to initial state | `/_lab/reset` | `POST` | All Things, or one with `{"id": ...}`. |
| Inject property values | `/_lab/state` | `POST` | `{"id": ..., "values": {...}}`; bypasses TD writability. |

`/_lab/things` is the collection of running Things: `GET` lists them, `POST` adds
more from a Thing Model.

## Environments

An **environment** is a named bundle of Thing Models with **fixed instance ids**,
optional per-Thing `state` overrides and per-instance `links` (one shared model
can point at a different related Thing per instance), and optional URI→id
aliases - one JSON manifest in
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
curl localhost:8081/_lab/environments/smart-home         # one environment's manifest
curl localhost:8081/_lab/environments/smart-home/tasks   # its benchmark tasks
curl -X POST localhost:8081/_lab/reset          # reset every Thing to initial state
curl -X POST localhost:8081/_lab/state  -d '{"id":"bank-alice","values":{"balance":1000}}'
```

Six environments make up the benchmark - **76 tasks across seven difficulty
levels** (L0-L5 and S) - each built from Thing Models under `src/things/` with
cross-Thing `vre:effects` (and `logic.js` only where VRE can't reach):

| Environment | Things | Tasks | Description |
| --- | --- | --- | --- |
| `e-commerce` | 4 | 14 | A shopping cart and three bank accounts; checkout and transfer are cross-Thing effects. |
| `supply-chain` | 6 | 16 | Three warehouses, their aggregate, a company budget and a supplier; orders charge the budget, transfers move stock. |
| `social-media` | 3 | 14 | Three pages of a decentralized social network; following and liking are cross-Thing effects. |
| `smart-home` | 7 | 15 | A home energy hub, thermostat, washer, dryer, car charger, and a plug powering a lamp. |
| `ibm-building3` | 2279 | 11 | The **smart office**: an office building of 281 rooms, each with a colour lamp, radiator, temperature sensor, and door and window sensors and actuators. From the IBM Dublin building model. |
| `mosaik` | 37 | 6 | The **factory**: a MOSAIK shopfloor of 25 products (6 of them battery spare parts), ten workstations, a transporter and the recipe book; a plan can run to 618 invocations, and every produce Action names the products it consumes and the one it builds. |

A seventh manifest, `ibm-building3-small` (17 Things, 4 tasks), is a two-room
subset of the smart office for iterating without the full building's start-up;
it is a convenience variant, not one of the six benchmark environments.

The smart office and factory are converted from the tee-wip paper repository by
`tools/tee2wotlab.py`; [`NOTICE.md`](NOTICE.md) records where their data comes from.
Each environment's benchmark tasks live in
`src/environments/<name>/tasks.json`; see [`tools/README.md`](tools/README.md).

All `/_lab` writes are loopback-only unless `WOT_LAB_ALLOW_REMOTE_WRITE=1`.

A new Thing Model is sent either as a `spec` (the shape the dashboard form
produces) or as a `draft` (the two files verbatim). Both go through the same
validation: names must be slugs, every property and nested member needs a type,
every property needs an initial state value of that type, and any `vre:effects`
program must compile - so a Thing that would not work never reaches disk.

Writes are refused from anywhere but localhost, since this API creates files and
the WoT server binds every interface. Set `WOT_LAB_ALLOW_REMOTE_WRITE=1` for a
deliberately shared lab.

## Examples

### Included Things

WoT-Lab comes with example Things:

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

WoT-Lab is a development tool, and it is built to be run on a machine you trust, for people you trust.

- **A Thing Model is code.** `logic.js` is `eval`'d in the lab's process with no isolation. Treat a
  Thing Model from someone else like any other script you are about to run. (`vre:effects` are
  narrower: they are parsed, and only what the parser accepts is compiled - literals and names are
  emitted as quoted strings - so an effect can change state but cannot call out of it.)
- **The server listens on every interface** (`*:8081`), so the Things - their Thing Descriptions,
  properties, actions and events - are reachable by anyone who can reach the port. There is no
  authentication; every Thing is served with the `nosec` security scheme.
- **The lab API (`/_lab`) accepts writes from this machine only.** It creates files and starts
  Things, so requests that change anything are refused unless they come from a loopback address.
  `WOT_LAB_ALLOW_REMOTE_WRITE=1` lifts that for a deliberately shared lab; set it only on a
  network where everyone who can reach the port may write Thing Models to the models directory,
  start and stop Things, and overwrite their state. The API writes a Thing Description and a
  `state.json`, never a `logic.js`.
- **`--solid-container` sends interaction provenance off-box.** It is unset by default; set, the lab
  posts every interacted-with Thing's full state, the request that reached it - including its body -
  and the agent or address it came from, unauthenticated, to the container you name - see
  [Publishing provenance to a Solid pod](#publishing-provenance-to-a-solid-pod).

To report a vulnerability, see [`SECURITY.md`](SECURITY.md).

## Deployment

`.github/workflows/cd.yml` deploys `main`. It packages **code only** - `src`,
`frontend/dist`, and the manifests - and unpacks each release side by side on
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
Description=WoT-Lab
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
