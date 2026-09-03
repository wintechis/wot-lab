# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

WoT Lab is a TypeScript framework for prototyping virtual **Web of Things** (W3C WoT) devices. It exposes each virtual device ("Thing") over the standard WoT HTTP protocol via `@node-wot`.

## Runtime & tooling

This project runs on **Bun** (`bun.lock`, `bun install`). Bun executes the TypeScript sources directly — there is no transpile/`dist` step for running. `bun --watch` provides hot reload (replaces the old `nodemon`/`tsx` setup). Bun's Node-compat layer runs `@node-wot`, n3, and Valtio unchanged, and Thing files are read with Bun-native `Bun.file()`.

Bun does **not** type-check. Type safety comes from `tsc --noEmit`, exposed as `bun run build` / `bun run typecheck`; run it (and it runs in CI) to catch type errors Bun's transpile-only execution ignores.

## Commands

```bash
bun run dev                          # Auto-discovery: load 1 instance of every Thing in src/things/
bun run dev -- --things counter:2,lamp:1   # Load specific Things/counts via CLI
bun run dev:config                   # Load from ./wot-config.json
bun run dev:debug                    # dev + all debug logging (DEBUG=wot-lab:*)
bun run build                        # tsc --noEmit (type-check only; alias: typecheck)
bun start                            # run src/main.ts directly (no build step needed)
bun run lint                         # eslint src/**/*.ts
bun run lint:fix
```

There is **no test runner configured**. The `*client` scripts (e.g. `bun run counterclient`, `bun run lampclient`) run per-Thing WoT clients in `src/things/<name>/exampleClient.ts` and serve as manual/integration checks.

Debug logging uses the `debug` package with hierarchical namespaces `wot-lab:<area>:*` where area is one of `system`, `config`, `things`, `state`, `simulation` (e.g. `DEBUG=wot-lab:things:*,wot-lab:state:* bun run dev`). See `src/utils/debug.ts`.

## The WoT server

`src/main.ts` starts one server on launch: the **WoT protocol server** (`@node-wot/binding-http`, default port **8081**, configurable via `wot-config.json` → `global.wotPort`) — it serves the Thing Descriptions and standard WoT property/action/event affordances. (A separate Express "Simulation REST API" on `/api/v1` was removed; `globalState` remains as internal, in-process state tracking, no longer exposed over HTTP.)

## Thing file layout (TD + state required; logic.js / VRE optional)

Each Thing lives in `src/things/<name>/`:
- `<name>.td.json` — W3C Thing Description (capabilities: properties/actions/events). **Required.**
- `state.json` — initial state object. Any string value ending in `T00:00:00.000Z` is replaced with the current timestamp at load time (see `loadStateFile`). **Required.**
- `logic.js` — imperative behavior. **Optional.** Read as text and `eval`'d inside an async wrapper (`ThingHandler.ts` → `evaluateLogicFile`). The wrapper injects these locals, available with no import: `thing` (the WoT `ExposedThing`), `state` (a Valtio proxy of `state.json`), `http`, `URL`, `createLoggers`.
- `vre:effects` in action affordances — declarative action effects (VRE). **Optional.** See the VRE section below.

`logic.js` typically calls `thing.setPropertyReadHandler(...)`, `thing.setActionHandler(...)`, and `thing.emitPropertyChange(...)`. Mutating `state.*` is reactive (Valtio) and reflected in the global state store. Some `state.js` files exist alongside `state.json` but the loader only reads `state.json`.

**No-logic.js Things (TD + state [+ VRE] only):** when `logic.js` is absent, `evaluateLogicFile` auto-generates a default property read handler for every TD property (`setPropertyReadHandler(name, () => state[name])`), so the Thing's state is observable over WoT without any hand-written code. Combined with a `<name>.vre` effect file (below), a Thing can be declared purely as TD + `state.json` + `.vre` — see `src/things/vswitch/` for a minimal example. When `logic.js` **is** present it is used verbatim (it wires its own reads), so the generated defaults apply only to the no-logic case; property names must match `state` keys for the defaults to resolve.

Adding a directory under `src/things/` is enough for auto-discovery to pick it up — no registration step.

## Load path (how a Thing becomes live)

`main.ts` → `ConfigLoader.getConfiguration()` (CLI `--things` > `wot-config.json` > `null`=auto-discover) → `ThingFactory` calls `loadAllThings()`/`loadConfiguredThings()` in `ThingHandler.ts`. `loadThing()` reads the TD, `state.json`, and (optionally) `logic.js` / `<name>.vre` from disk with **`Bun.file(...)`** (`.json()` / `.text()`), loads state into a Valtio `proxy`, evaluates the combined logic + VRE-generated handlers, registers the state in `globalState`, then `ThingFactory.createThing()` does `wot.produce(td)` → `handler.setup(exposedThing)` → `exposedThing.expose()`. `ConfigLoader` likewise uses `Bun.file().exists()`/`.json()`.

Instance IDs: multiple instances → `<prefix>-1`, `<prefix>-2`; single → `<prefix>` (prefix defaults to the Thing name, overridable via `idPrefix`). The internal TD id becomes `urn:wot:<instanceId>`; the `urn:wot:` prefix is stripped to form the `thingId` key used in `globalState.things[thingId]`.

## Global state

`globalState` (`src/globalState.ts`) is a single Valtio proxy `{ things: Record<thingId, stateProxy> }`; each Thing's state is registered here at load (`addThingToGlobalState`) and its `subscribe` emits debug logs on change. It is in-process only and not exposed over any HTTP API — nothing currently reads back the aggregated state, so it functions as a state registry / observability hook.

## VRE: declarative action effects (`<name>.vre`)

Action handlers can be **generated from a declarative effect file** instead of hand-written. A Thing's optional `<name>.vre` contains standard VRE bindings and primed assignments; `evaluateLogicFile` compiles them and **appends generated `thing.setActionHandler(...)` code** to the logic body before eval. Since standard VRE does not declare actions, multi-action files use `// action(params):` section headers; a headerless file is allowed for a Thing with one action. This works with or without `logic.js`, so an action's runtime behavior may come from the `.vre` file, not only from `logic.js`.

Dialect and pipeline:
- `src/things/vre-parser.ts` — lexer + AST + recursive-descent parser aligned with the V-Realm project's VRE (`vre-to-spa.ts`): `const`/URI bindings followed by primed effect assignments. VRE has no action blocks or permission guards; WoT-Lab uses `// action(params):` comments as adapter metadata.
- `src/things/vre.ts` — wot-lab codegen. Effects `<prop>' = <expr>` become `state.<prop> = <expr>` + `thing.emitPropertyChange(<prop>)` (so effects are observable via `observeProperty`, not just `readProperty`).
- Reference resolution is TD-informed: a bare identifier naming an action **input parameter** resolves to that input value; a bare identifier naming a **Thing property** resolves to `state[name]`; effect targets (LHS) must be Thing properties. Cross-Thing/dotted refs are not supported (single-Thing loader).

Example (`src/things/lamp/lamp.vre`): `const lamp = <urn:wot:lamp>;` followed by `// setBrightness(brightness):` and `lamp.brightness' = brightness;`. `src/things/vswitch/` is a full TD + `state.json` + `.vre` Thing with **no** `logic.js`.

## Conventions & gotchas

- **ESM throughout** (`"type": "module"`, `module: nodenext`). Relative imports in `.ts` source must use the `.js` extension (e.g. `./globalState.js`). `strict` is on.
- `logic.js` is executed via `eval` with injected globals — it has no `import`/`require` and no type checking; treat it as sandboxed script text, not a module.
- `thingId` is the `urn:wot:`-stripped, lowercased, space-hyphenated id (`ensureUniqueId`); it is the key into `globalState.things`.
