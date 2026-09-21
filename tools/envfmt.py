#!/usr/bin/env python3
"""The house layout for an environment manifest, and a formatter that applies it.

A manifest is read far more often than it is parsed, and what a reader wants is
one line per Thing: model, id and title together, then the state it starts in.
Fully expanded JSON buries that under a key per line — `ibm-building3.json` is
2279 Things, which is 749 KB expanded and 300 KB like this.

    { "name": "smart-home",
      "description": "Alice's smart home",
      "things": [
        { "model": "smart-plug", "id": "plug", "title": "Reading Plug",
          "state": { "poweredOn": false, "device": "lamp" } },
        { "model": "dimmable-lamp", "id": "lamp", "title": "Reading Lamp",
          "state": { "poweredOn": false, "brightness": 100 },
          "links": [{ "href": "/plug", "rel": "controlledBy" }] } ] }

Run it to reformat every manifest in place; import `dumps` to write one.

    python3 tools/envfmt.py
"""

from __future__ import annotations

import json
import os

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENVS = os.path.join(REPO, "src", "environments")

# The order a Thing's fields read in: what it is, then what it starts as.
THING_KEYS = ("model", "id", "title", "state", "links", "td")
# The identifying fields share the first line; the rest get one line each.
HEAD_KEYS = ("model", "id", "title")


def inline(value) -> str:
    """One line of JSON, spaced to be read rather than parsed."""
    if isinstance(value, dict):
        body = ", ".join(f"{json.dumps(k)}: {inline(v)}" for k, v in value.items())
        return "{ " + body + " }" if body else "{}"
    if isinstance(value, list):
        body = ", ".join(inline(v) for v in value)
        return "[" + body + "]" if body else "[]"
    return json.dumps(value, ensure_ascii=False)


def thing_lines(thing: dict) -> list[str]:
    unknown = [k for k in thing if k not in THING_KEYS]
    if unknown:
        raise SystemExit(f"thing '{thing.get('id')}': unexpected field(s) {unknown}")
    head = ", ".join(
        f"{json.dumps(k)}: {inline(thing[k])}" for k in HEAD_KEYS if k in thing
    )
    lines = ["{ " + head + ("," if any(k in thing for k in THING_KEYS[3:]) else "")]
    rest = [k for k in THING_KEYS[3:] if k in thing]
    for index, key in enumerate(rest):
        tail = "," if index < len(rest) - 1 else ""
        lines.append(f"{json.dumps(key)}: {inline(thing[key])}{tail}")
    return lines


def dumps(manifest: dict) -> str:
    """The manifest in the house layout."""
    out = []
    for key, value in manifest.items():
        if key == "things":
            continue
        out.append(f'  {json.dumps(key)}: {inline(value)},')
    out[0] = "{" + out[0][1:]  # the first key shares the opening brace
    out.append('  "things": [')

    things = manifest["things"]
    for index, thing in enumerate(things):
        lines = thing_lines(thing)
        for position, line in enumerate(lines):
            out.append(("    " if position == 0 else "      ") + line)
        # The Thing closes on its own last line; the last Thing closes the file.
        out[-1] += " } ] }" if index == len(things) - 1 else " },"
    return "\n".join(out) + "\n"


def write(path: str, manifest: dict) -> None:
    text = dumps(manifest)
    if json.loads(text) != manifest:
        raise SystemExit(f"{path}: formatting changed the manifest")
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(text)


def main() -> None:
    for name in sorted(os.listdir(ENVS)):
        if not name.endswith(".json"):
            continue
        path = os.path.join(ENVS, name)
        with open(path, encoding="utf-8") as handle:
            manifest = json.load(handle)
        write(path, manifest)
        size = os.path.getsize(path)
        print(f"  {name:28} {len(manifest['things']):>5} things  {size:>8} bytes")


if __name__ == "__main__":
    main()
