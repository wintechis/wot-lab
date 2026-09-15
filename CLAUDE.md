# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

WoT Lab is a TypeScript framework for prototyping virtual **Web of Things** (W3C WoT) devices. It exposes each virtual device ("Thing") over the standard WoT HTTP protocol via `@node-wot`.

## Runtime & tooling

This project runs on **Bun** (`bun.lock`, `bun install`). Bun executes the TypeScript sources directly — there is no transpile/`dist` step for running. `bun --watch` provides hot reload (replaces the old `nodemon`/`tsx` setup). Bun's Node-compat layer runs `@node-wot`, n3, and Valtio unchanged, and Thing files are read with Bun-native `Bun.file()`.

Bun does **not** type-check. Type safety comes from `tsc --noEmit`, exposed as `bun run build` / `bun run typecheck`; run it (and it runs in CI) to catch type errors Bun's transpile-only execution ignores.

## Commands

```bash
bun run dev                          # Start empty: no Things until you add them (dashboard or --things)
bun run dev -- --things counter:2,lamp:1   # Start specific Things/counts
bun run dev:demo                     # dev + a few Things running, for a quick look
bun run dev:debug                    # dev + all debug logging (DEBUG=wot-lab:*)
bun run build                        # tsc --noEmit (type-check only; alias: typecheck)
bun start                            # build the dashboard, then run src/main.ts
bun run lint                         # eslint src/**/*.ts
bun run lint:fix

# Dashboard (frontend/, its own tsconfig + Vite config)
bun run frontend:build               # tsc -p frontend/tsconfig.json && vite build -> frontend/dist/
bun run frontend:dev                 # Vite dev server for the dashboard alone
```

`dev`/`start` run `frontend:build` first, so the dashboard is rebuilt on launch; the running lab re-serves it on mtime change (`loadFrontendAsset`), so a standalone `frontend:build` is picked up without restarting the server. `frontend/` type-checks separately from `src/` (`bun run build` only covers `src/`).

There is **no test runner configured**. The `*client` scripts (e.g. `bun run counterclient`, `bun run lampclient`) run per-Thing WoT clients in `src/things/<name>/exampleClient.ts` and serve as manual/integration checks.

Debug logging uses the `debug` package with hierarchical namespaces `wot-lab:<area>:*` where area is one of `system`, `config`, `things`, `state`, `simulation` (e.g. `DEBUG=wot-lab:things:*,wot-lab:state:* bun run dev`). See `src/utils/debug.ts`.

## The WoT server

`src/main.ts` starts one server on launch: the **WoT protocol server** (`@node-wot/binding-http`, default port **8081**, configurable via `--port` / `WOT_LAB_PORT`) — it serves the Thing Descriptions and standard WoT property/action/event affordances. (A separate Express "Simulation REST API" on `/api/v1` was removed; `globalState` remains as internal, in-process state tracking, no longer exposed over HTTP.)

## Thing Model layout (TD + state required; logic.js / VRE optional)

A **Thing Model** is a directory named after itself — the Thing Description and initial state a Thing is built from. Things are created *from* a model; the model itself never runs.

The catalog has up to two roots (`modelRoots()` in `ThingHandler.ts`): the **bundled** models in `src/things/` and, when `--models-dir` / `WOT_LAB_MODELS_DIR` is set, a **user** directory that is searched first and is where the dashboard writes. Bundled models report `writable: false` and cannot be deleted through the API — they are part of the release, so deleting one would only last until the next deploy. In a checkout the flag is unset and authoring writes to `src/things/`, unchanged.
- `<name>.td.json` — W3C Thing Description (capabilities: properties/actions/events). **Required.**
- `state.json` — initial state object. Any string value ending in `T00:00:00.000Z` is replaced with the current timestamp at load time (see `loadStateFile`). **Required.**
- `logic.js` — imperative behavior. **Optional.** Read as text and `eval`'d inside an async wrapper (`ThingHandler.ts` → `evaluateLogicFile`). The wrapper injects these locals, available with no import: `thing` (the WoT `ExposedThing`), `state` (a Valtio proxy of `state.json`), `http`, `URL`, `createLoggers`.
- `vre:effects` on an action affordance — declarative action effects (VRE). **Optional.** See the VRE section below. This is the only VRE form: `.vre` files are no longer read.

`logic.js` typically calls `thing.setPropertyReadHandler(...)`, `thing.setActionHandler(...)`, and `thing.emitPropertyChange(...)`. Mutating `state.*` is reactive (Valtio) and reflected in the global state store. Some `state.js` files exist alongside `state.json` but the loader only reads `state.json`.

**No-logic.js Things (TD + state [+ VRE] only):** when `logic.js` is absent, `evaluateLogicFile` auto-generates a read handler for every TD property (`setPropertyReadHandler(name, () => state[name])`) **and** a write handler for every property not marked `readOnly` (assign to `state[name]`, then `emitPropertyChange`), so the Thing's state is readable, writable and observable over WoT without any hand-written code. Generating the write half matters because the TD advertises the affordance either way: without it a writable property would be published and then fail on `PUT`. Combined with `vre:effects` annotations (below), a Thing Model can be declared purely as TD + `state.json` — see `src/things/vswitch/` for a minimal example. When `logic.js` **is** present it is used verbatim (it wires its own reads), so the generated defaults apply only to the no-logic case; property names must match `state` keys for the defaults to resolve.

Adding a directory under `src/things/` makes the *Thing Model* available — no registration step — but does not start anything: create a Thing from it in the dashboard, or name the model in `--things`.

## Load path (how a Thing becomes live)

**Nothing is instantiated implicitly.** `src/things/` is a *catalog of Thing Models*, not a roster of what runs. A Thing comes online in exactly one place — `ThingRegistry.bringOnline()` — reached three ways: the `--things` flag at startup (`parseArgs` in `src/config/options.ts`), the lab API the dashboard calls (`src/http/labApi.ts`), and an **environment** manifest (`--env` / `POST /_lab/environments`; see the Environments section). The first two *allocate* ids (`allocateId`: `lamp`, `lamp-2`); an environment *pins* them from the manifest, which is what lets a scenario's cross-Thing references resolve to the same instances every run. The environment manifest is the one config file, and a deliberate one — it exists to make a benchmark reproducible.

`main.ts` → `parseArgs()` → `ThingRegistry` (constructed with the started `wot` and the `servient`) → `registry.instantiateAll(options.things)`. Per Thing: `registry.allocateId(prefix)` mints the id (`lamp`, then `lamp-2`), `loadThing(model, id, title)` reads the TD, `state.json` and optionally `logic.js` with **`Bun.file(...)`**, loads state into a Valtio `proxy`, evaluates the combined logic + VRE-generated handlers, and registers the state in `globalState`; then `ThingFactory.createThing()` does `wot.produce(td)` → `handler.setup(exposedThing)` → `exposedThing.expose()`.

**Identity.** `loadThing`'s `instanceId` is **required**. Without one, a TD reaches node-wot with no `id` and the servient mints a random `urn:uuid:` — a different URL on every boot — so the required parameter is what makes that state unrepresentable. `allocateId` is the only place ids are minted, and `addThingToGlobalState` throws on collision rather than renaming, so the id in the TD and the key in `globalState` cannot drift apart.

**Titles vs. URLs.** node-wot's HTTP binding addresses a Thing by `slugify(title)`, not by its `id`, and bakes that path into every generated form. `ThingFactory.createThing` therefore produces the Thing with the *instance id as its title*, then restores the human title on the ExposedThing immediately after `expose()` (the TD is serialized from that object on each request). Result: the URL, the form hrefs and the TD's `id` all agree, while the title stays readable — `/motion` is "Motion Sensor".

**Authoring.** `src/things/ThingAuthor.ts` builds a new Thing Model's two files from a form spec (or takes them verbatim), validates them recursively — slug name, every property and nested member typed, every property present in `state.json` with a value of its declared type, `vre:effects` compiled through the real codegen — and stages them outside `src/things/` before a single `rename`, so a half-written model is never in the catalog. A datatype is recursive (`SchemaSpec`): properties, action inputs and outputs, and event payloads can be objects and arrays at any depth.

## Global state

`globalState` (`src/globalState.ts`) is a single Valtio proxy `{ things: Record<thingId, stateProxy> }`; each Thing's state is registered here at load (`addThingToGlobalState`, which throws on a duplicate id) and its `subscribe` emits debug logs on change. It is in-process only and not exposed over any HTTP API — nothing currently reads back the aggregated state, so it functions as a state registry / observability hook.

## VRE: declarative action effects (`vre:effects`)

Action handlers can be **generated from declarative effect annotations** instead of hand-written. An action affordance's optional `vre:effects` string contains VRE primed assignments; `evaluateLogicFile` compiles every such annotation in the TD and **appends generated `thing.setActionHandler(...)` code** to the logic body before eval. This works with or without `logic.js`, so an action's runtime behavior may come from the annotation, not only from `logic.js`.

Effects are annotations on the affordance they belong to — there is no separate file form. `.vre` files are not read (support was removed); the action a program belongs to is simply the affordance carrying it, so VRE's lack of action declarations needs no adapter metadata.

Dialect and pipeline:
- `src/things/vre-parser.ts` — lexer + AST + recursive-descent parser aligned with the V-Realm project's VRE (`vre-to-spa.ts`): `const`/URI bindings followed by primed effect assignments.
- `src/things/vre.ts` — wot-lab codegen (`vreEffectsToHandlers`). Effects `<prop>' = <expr>` become `state.<prop> = <expr>` + `thing.emitPropertyChange(<prop>)` (so effects are observable via `observeProperty`, not just `readProperty`).
- Reference resolution is TD-informed: a bare identifier naming an action **input parameter** resolves to that input value; a bare identifier naming a **Thing property** resolves to that property. An object `input` schema exposes its properties by name; a scalar `input` is referred to as `input`.

**Cross-Thing effects, snapshot semantics, outputs (VRE).** VRE is no longer single-Thing:
- **Cross-Thing.** A dotted `handle.prop` (target or value) names a property on *another* Thing, where `handle` is a static binding (`const bank = <bank-id>`), an action input parameter carrying a Thing reference, or a **Thing property whose value is a Thing reference** (so one shared annotation can target a per-instance device — e.g. a `smart-plug`'s `device.powered' = true`). `src/things/crossThing.ts` resolves the reference (alias table, then instance id, then a URI's last segment) to the other Thing's live Valtio proxy — which its own read handlers serve, so a cross-Thing write is visible immediately — and fires *its* `emitPropertyChange` via a registry of exposed Things. Everything is in-process; there are no remote WoT calls. `this.id` is the running instance's own id.
- **Snapshot-then-apply.** Every effect's right-hand side is evaluated against a pre-state snapshot, then all effects apply at once — across Things too (V-Realm's flat-effect semantics). This is why an effect can read a value another effect in the same action overwrites.
- **Pre/post convention.** In expressions, an unprimed reference is the **pre-state** value and a primed reference (`x'`) is the **post-state** value; primes are rejected on the right-hand side of an effect. The one convention shared by VRE effects, VRE outputs and VRP.
- **Outputs.** `output.<path> = <expr>` (dotted paths allowed) builds the action's return value, evaluated after effects apply. Behaviour VRE cannot express (array lookups, sums, object construction) stays in `logic.js` — the two compose (`logic.js` wires some actions, `vre:effects` the rest).
- **Clock.** `now()` returns an ISO string and `hour()` the UTC hour, both read from the controllable clock (`src/things/clock.ts`), so time-dependent behaviour is reproducible.

Examples in the tree: `src/things/counter/counter.td.json` (`"count' = count + 1; emitEvent(\"change\", count');"` — note the primed post-state value in the event), `src/things/lamp/lamp.td.json`, `src/things/vswitch/` (TD + `state.json`, **no** `logic.js`), and the ported scenarios under `src/environments/` (e.g. `shopping-cart` checkout is a cross-Thing effect; `bank-account` transfer moves money between two accounts).

## Environments (benchmark scenarios)

An **environment** is a named bundle of Thing Models with **fixed instance ids**, optional per-Thing `state` overrides and per-instance `links` (so one shared model can point at a different related Thing per instance), optional URI→id aliases, and an optional `clock` to pin — one JSON manifest in `src/environments/<name>.json` (`src/things/environments.ts`). It is the reproducible unit a benchmark runs against: the same Things, ids and initial state, one command.

- **Start:** `bun run dev -- --env e-commerce` (or `WOT_LAB_ENV`, or `POST /_lab/environments {"name": ...}`). `GET /_lab/environments` lists them.
- **Reset:** `POST /_lab/reset` re-applies every Thing's captured initial state (or one, with `{"id": ...}`) — the between-runs reset. The registry snapshots initial state in `bringOnline`.
- **Inject:** `POST /_lab/state {"id": ..., "values": {...}}` writes property values straight to the state proxy, **bypassing TD writability**, to construct initial conditions. Loopback-gated like the rest of the lab API.
- **Clock:** `GET/POST /_lab/clock` sets (`{"iso"|"millis"}`), advances (`{"advanceMs"}`) or reals (`{"real": true}`) the virtual clock behind VRE `now()`/`hour()`.

The four ported scenarios live here: `e-commerce`, `supply-chain`, `social-media`, `smart-home`. Each is TD + `state.json` (+ `vre:effects`, + `logic.js` only where VRE can't reach — catalog price lookups, object construction, clock-derived reads). None run implicitly; name one with `--env`.

## Conventions & gotchas

- **The dashboard** (`frontend/`, React + Primer) is built by `bun run frontend:build` into `frontend/dist/` and served by `endpointMiddleware`. It talks to `/_lab/*` for anything that changes what is running; `frontend/src/api.ts` holds those calls. The lab API collections: `/_lab/thing-models` (the catalog on disk; `POST` writes a new one), `/_lab/things` (what is running; `GET` also returns the `--things` flag that reproduces it, `POST` creates more from a model, `DELETE /_lab/things/{id}` takes one offline), `/_lab/environments` (list / start a scenario), and the benchmark controls `/_lab/reset`, `/_lab/state`, `/_lab/clock`.
- **Vocabulary**: a *Thing Model* is the directory on disk; a *Thing* is a running instance of one. `frontend/src/App.tsx` keeps a separate local type `InspectedThing` for the parsed TD it renders — deliberately not called `ThingModel`, which is imported from `./api` in the W3C sense.
- **The built frontend is revalidated by mtime** (`loadFrontendAsset`), so `bun run frontend:build` is picked up by a running lab without a restart.
- **Deploys** (`.github/workflows/cd.yml`, main only) ship code as a release directory and switch `~/wot-lab/current` with a symlink; `~/wot-lab/shared/` holds one `node_modules` and the authored `thing-models/`, so neither is touched by a release. CI gates every branch; CD no longer duplicates that build.
- **Lab API writes are loopback-only** unless `WOT_LAB_ALLOW_REMOTE_WRITE=1` — a dashboard reached over the network cannot create Things without it.
- **`_lab` and `assets` are reserved** path segments (`reservedNames` in `ThingAuthor.ts`) — a Thing Model may not take either name. `_lab` is additionally unspellable as a model name, since names must match `/^[a-z][a-z0-9-]*$/`.
- **ESM throughout** (`"type": "module"`, `module: nodenext`). Relative imports in `.ts` source must use the `.js` extension (e.g. `./globalState.js`). `strict` is on.
- `logic.js` is executed via `eval` with injected globals — it has no `import`/`require` and no type checking; treat it as sandboxed script text, not a module.
- `thingId` is the `urn:wot:`-stripped id, normalised to a slug by `normalizeThingId`; it is the key into `globalState.things`, the URL segment, and the `id` in the served TD — the same string in all three.
