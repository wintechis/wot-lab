# Contributing

Thanks for taking an interest in WoT Lab.

## Setup

```bash
bun install
bun run dev              # empty lab + dashboard on http://localhost:8081/
bun run dev:demo         # the same, with a few Things running
```

WoT Lab runs on [Bun](https://bun.sh), which executes the TypeScript sources directly.

## Before you open a pull request

```bash
bun run build            # type-check src/ (Bun itself does not)
bun run frontend:build   # type-check and build the dashboard
bun run lint
```

CI runs the same three. There is no unit-test runner; behaviour is checked against a running lab:

- `bun run <thing>client` runs the example WoT client of a Thing Model
  (`src/things/<name>/exampleClient.ts`).
- `python3 tools/verify_tasks.py <environment>` replays an environment's benchmark tasks and
  checks every claim they make. If you change a Thing Model that an environment uses, run it for
  that environment. A task that stops working is fixed in the task, not by bending the environment.

## Adding a Thing Model

A directory under `src/things/<name>/` with `<name>.td.json` and `state.json` is all it takes; see
[Creating Things](README.md#creating-things). Prefer `vre:effects` to `logic.js` where the
behaviour can be expressed declaratively — it keeps a run reproducible from its initial state.

## Conventions

- ESM throughout; relative imports in `.ts` files use the `.js` extension.
- Match the code around you: its naming, its comment density, and comments that say *why*.
- `CLAUDE.md` is the architecture guide — it is written for coding agents but is the fastest way
  for anyone to learn how a Thing comes online. Keep it true when you change what it describes.

## Licence

WoT Lab is licensed under the [AGPL-3.0](LICENSE). By contributing you agree that your contribution
is licensed under the same terms. Third-party data shipped with the repository is listed in
[`NOTICE.md`](NOTICE.md).

Security issues: please see [`SECURITY.md`](SECURITY.md) rather than opening an issue.
