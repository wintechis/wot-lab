#!/usr/bin/env python3
"""Convert a tee-wip benchmark environment into wot-lab Thing Models.

The tee-wip repository publishes each scenario as `{{id}}`-templated Thing
Model files plus one central `state.json` keyed by instance. wot-lab wants the
opposite split: a Thing Model is a directory holding one Thing Description and
the state a Thing starts with, and an environment manifest pins the instances.
This script performs that split, and with it four dialect changes:

  * `wotlab:effect` + `wotlab:bindings` become one `vre:effects` string, the
    bindings written as VRE's own `const name = <id>;` lines.
  * Thing references are rewritten from `./Foo.td.json` to the instance id
    wot-lab resolves. `resolveThing` matches an alias, an id or a URI's last
    segment; a file name is none of those.
  * A primed reference on the right-hand side of an effect is inlined, since
    wot-lab rejects one (`assertNoPost`) rather than ordering effects.
    `xpos' = xpos - 1; carrying.xpos' = xpos'` becomes
    `carrying.xpos' = xpos - 1`, which is what flat snapshot semantics mean.
  * `{{id}}` forms and the `tm:ThingModel` marker are dropped: node-wot
    generates the forms, and an instance is not a model.

Ids are slugified the way `normalizeThingId` does, because that is the spelling
wot-lab uses for the state key, the URL and the Thing Description's `id` alike.
Two source ids that slugify to the same string are disambiguated by suffix, and
the mapping is reported.

Usage:
    python3 tools/tee2wotlab.py <tee-wip>/environments/mosaik \\
        --prefix mosaik --name mosaik --per-instance workstation

    python3 tools/tee2wotlab.py <tee-wip>/environments/ibm-building3 \\
        --prefix b3 --name ibm-building3
"""

from __future__ import annotations

import argparse
import collections
import json
import os
import re
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from envfmt import dumps as dump_manifest  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
THINGS_DIR = os.path.join(REPO, "src", "things")
ENVS_DIR = os.path.join(REPO, "src", "environments")

# Keys the conversion consumes or replaces; none of them belong in the model TD.
DROP_TD_KEYS = {"id", "wotlab:thingModel", "forms"}
DROP_ACTION_KEYS = {"wotlab:effect", "wotlab:bindings", "forms"}
# Annotations that describe the instance, not the type: carried per instance.
ANNOTATION_KEYS = ("brick:isPointOf", "brick:isLocatedIn", "rwld:comfortValue")


def normalize_thing_id(value: str) -> str:
    """The spelling `normalizeThingId` in src/globalState.ts produces."""
    slug = re.sub(r"[^a-z0-9]+", "-", value.strip().lower())
    return slug.strip("-")


# --------------------------------------------------------------------------
# VRE
# --------------------------------------------------------------------------


def split_statements(source: str) -> list[str]:
    """Split a VRE program on top-level `;`, respecting string literals."""
    out: list[str] = []
    current = ""
    in_string = False
    for char in source:
        if char == '"':
            in_string = not in_string
        if char == ";" and not in_string:
            out.append(current)
            current = ""
        else:
            current += char
    out.append(current)
    return [s.strip() for s in out if s.strip()]


def strip_strings(text: str) -> str:
    """The statement with string literals blanked, for safe pattern matching."""
    return re.sub(r'"(?:[^"\\]|\\.)*"', '""', text)


def inline_primed_rhs(source: str, where: str) -> str:
    """Replace a primed (post-state) reference in an effect by what produces it.

    wot-lab evaluates every effect against the pre-state snapshot and applies
    them together, so `x'` on a right-hand side has no meaning and is rejected.
    The dump uses it as shorthand for "the value the sibling effect writes", and
    that value is exactly the sibling's right-hand side.
    """
    statements = split_statements(source)
    assignments: dict[str, str] = {}
    for statement in statements:
        if statement.startswith("output."):
            continue
        lhs, _, rhs = statement.partition("=")
        target = lhs.strip().rstrip("'").strip()
        if "." not in target:
            assignments[target] = rhs.strip()

    rewritten: list[str] = []
    for statement in statements:
        if statement.startswith("output."):
            rewritten.append(statement)
            continue
        lhs, _, rhs = statement.partition("=")
        rhs = rhs.strip()
        for name, replacement in assignments.items():
            if "'" in replacement:
                raise SystemExit(
                    f"{where}: '{name}' is defined from another primed value; "
                    "inlining would not terminate"
                )
            rhs = re.sub(
                rf"(?<![A-Za-z0-9_.]){re.escape(name)}'", f"({replacement})", rhs
            )
        if "'" in strip_strings(rhs):
            raise SystemExit(
                f"{where}: a primed reference remains in an effect right-hand "
                f"side after inlining: {rhs}"
            )
        rewritten.append(f"{lhs.strip()} = {rhs}")
    return ";\n".join(rewritten) + ";"


def to_vre_effects(action: dict, resolve: callable, where: str) -> str:
    """One `vre:effects` program from `wotlab:effect` plus `wotlab:bindings`."""
    effect = action["wotlab:effect"]
    effect = inline_primed_rhs(effect, where)
    bindings = action.get("wotlab:bindings") or {}
    prelude = "".join(
        f"const {name} = <{resolve(target)}>;\n" for name, target in bindings.items()
    )
    return prelude + effect


# --------------------------------------------------------------------------
# Thing Descriptions
# --------------------------------------------------------------------------


def json_type(value) -> str:
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float):
        return "number"
    if value is None:
        return "null"
    if isinstance(value, str):
        return "string"
    if isinstance(value, list):
        return "array"
    return "object"


def normalize_schema(node):
    """Rewrite a union `type` into `oneOf`.

    The dump gives the transporter's `carrying` the type `["string", "boolean"]`
    - a product reference, or `false` while it carries nothing. A Thing
    Description's `type` is a single string, so node-wot rejects the Thing
    outright; `oneOf` says the same thing in the vocabulary the schema has. Each
    branch keeps the enum members of its own type.
    """
    if isinstance(node, list):
        return [normalize_schema(item) for item in node]
    if not isinstance(node, dict):
        return node
    out = {key: normalize_schema(value) for key, value in node.items()}
    if isinstance(out.get("type"), list):
        enum = out.pop("enum", None)
        branches = []
        for name in out.pop("type"):
            branch = {"type": name}
            if enum is not None:
                members = [
                    value
                    for value in enum
                    if json_type(value) == name
                    or (name == "number" and json_type(value) == "integer")
                ]
                if members:
                    branch["enum"] = members
            branches.append(branch)
        out["oneOf"] = branches
    return out


def rewrite_value(value, resolve: callable):
    """Rewrite every `./Foo.td.json` reference in a JSON value to an instance id."""
    if isinstance(value, str):
        match = re.fullmatch(r"\.{0,2}/?(.+)\.td\.json", value)
        return resolve(match.group(1)) if match else value
    if isinstance(value, list):
        return [rewrite_value(item, resolve) for item in value]
    if isinstance(value, dict):
        return {key: rewrite_value(item, resolve) for key, item in value.items()}
    return value


def prune_context(context, used_prefixes: set[str]):
    """Drop prefix bindings the converted Thing Description no longer uses."""
    if not isinstance(context, list):
        return context
    pruned = []
    for entry in context:
        if isinstance(entry, dict):
            kept = {k: v for k, v in entry.items() if k in used_prefixes}
            if kept:
                pruned.append(kept)
        else:
            pruned.append(entry)
    return pruned[0] if len(pruned) == 1 else pruned


def used_prefixes(node) -> set[str]:
    """Every `prefix:` used as a key or as a value anywhere in the document."""
    found: set[str] = set()
    if isinstance(node, dict):
        for key, value in node.items():
            if ":" in key and not key.startswith("http"):
                found.add(key.split(":", 1)[0])
            found |= used_prefixes(value)
    elif isinstance(node, list):
        for item in node:
            found |= used_prefixes(item)
    elif isinstance(node, str):
        if re.fullmatch(r"[A-Za-z][\w-]*:[\w#/.-]+", node) and not node.startswith(
            "http"
        ):
            found.add(node.split(":", 1)[0])
    return found


def build_model_td(
    source: dict,
    actions: dict,
    resolve: callable,
    model: str,
    extra_prefixes: set[str] | None = None,
) -> dict:
    """A wot-lab model Thing Description from a tee-wip Thing Model."""
    td: dict = {}
    for key, value in source.items():
        if key in DROP_TD_KEYS or key in ("properties", "actions", "@context"):
            continue
        if key == "@type":
            types = [t for t in value if t != "tm:ThingModel"]
            if types:
                td["@type"] = types[0] if len(types) == 1 else types
            continue
        td[key] = value

    properties = {}
    for name, schema in (source.get("properties") or {}).items():
        properties[name] = normalize_schema(
            rewrite_value(
                {k: v for k, v in schema.items() if k not in ("forms",)}, resolve
            )
        )
    if properties:
        td["properties"] = properties

    converted_actions = {}
    for name, schema in (actions or {}).items():
        out = {k: v for k, v in schema.items() if k not in DROP_ACTION_KEYS}
        out = normalize_schema(rewrite_value(out, resolve))
        if "wotlab:effect" in schema:
            out["vre:effects"] = to_vre_effects(schema, resolve, f"{model}.{name}")
        converted_actions[name] = out
    if converted_actions:
        td["actions"] = converted_actions

    ordered = {}
    for key in ("@context", "@type", "title", "description"):
        if key == "@context":
            # Prefixes an instance annotation uses (`brick:isPointOf`) are kept
            # too: the annotation lands on the instance, but the context it
            # needs comes from the model.
            ordered["@context"] = prune_context(
                source.get("@context"), used_prefixes(td) | (extra_prefixes or set())
            )
        elif key in td:
            ordered[key] = td.pop(key)
    ordered.update(td)
    return ordered


# --------------------------------------------------------------------------
# Conversion
# --------------------------------------------------------------------------


def most_common_state(states: list[dict], properties: dict) -> dict:
    """A model's own `state.json`: the value each Property most often starts at.

    Every instance overrides its state in the manifest, so this file exists to
    satisfy the loader and to make the model usable on its own (`--things`). The
    modal value describes the type best — except for a reference Property, where
    no value is better than one room's sensor standing in for every room's. An
    unset reference resolves to no Thing, so a model started on its own simply
    has nothing to write through until an environment or the lab API names one.
    """
    default = {}
    for key, schema in properties.items():
        if schema.get("format") == "uri-reference":
            default[key] = None
            continue
        values = [json.dumps(s[key], sort_keys=True) for s in states if key in s]
        if not values:
            default[key] = None
            continue
        default[key] = json.loads(collections.Counter(values).most_common(1)[0][0])
    return default


def write_json(path: str, data) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2, ensure_ascii=False)
        handle.write("\n")


def write_sidecars(args, src, id_map, model_of_instance, model_tds) -> None:
    """Carry the environment's reference data across, with ids rewritten.

    `rooms.json` (the Brick topology) and `tasks.json` (the goal the dump
    states, in the task schema: `request`, `goal`, `optimalPlan`) describe the environment but are not part of any Thing, and an
    environment manifest is a flat file. They go in a directory beside the
    manifest — `listEnvironments` reads files only, so the directory is inert —
    for whatever reads them next. Ids are rewritten so they name the Things the
    lab actually runs.
    """
    out_dir = os.path.join(ENVS_DIR, args.name)

    rooms_path = os.path.join(src, "rooms.json")
    if os.path.exists(rooms_path):
        rooms = json.load(open(rooms_path, encoding="utf-8"))
        kept = {}
        for room, record in rooms.items():
            things = [id_map[t] for t in record.get("things", []) if t in id_map]
            if things:
                kept[room] = {**record, "things": things}
        write_json(os.path.join(out_dir, "rooms.json"), kept)

    tasks_path = os.path.join(src, "tasks.json")
    if os.path.exists(tasks_path):
        tasks = []
        for task in json.load(open(tasks_path, encoding="utf-8")):
            if not all(
                step["thing"] in id_map
                for step in task.get("goal", []) + task.get("optimalPlan", [])
            ):
                continue
            task = dict(task, environment=args.name)
            # The dumps still carry the older field names for these two.
            for old, new in (("nl", "request"), ("referencePlan", "optimalPlan")):
                if old in task:
                    task[new] = task.pop(old)
            task["goal"] = [
                dict(step, thing=id_map[step["thing"]]) for step in task.get("goal", [])
            ]
            plan = []
            for step in task.get("optimalPlan", []):
                thing = id_map[step["thing"]]
                schema = (
                    model_tds[model_of_instance[step["thing"]]]
                    .get("actions", {})
                    .get(step["action"], {})
                    .get("input")
                )
                value = step.get("input")
                # A scalar Action takes the bare value, not a one-key object.
                if (
                    schema
                    and schema.get("type") != "object"
                    and isinstance(value, dict)
                    and len(value) == 1
                ):
                    value = next(iter(value.values()))
                plan.append(dict(step, thing=thing, input=value))
            task["optimalPlan"] = plan
            tasks.append(task)
        if tasks:
            write_json(os.path.join(out_dir, "tasks.json"), tasks)


def convert(args) -> None:
    src = os.path.abspath(args.source)
    manifest = json.load(open(os.path.join(src, "manifest.json"), encoding="utf-8"))
    states = json.load(open(os.path.join(src, "state.json"), encoding="utf-8"))
    annotations = {}
    annotations_path = os.path.join(src, "annotations.json")
    if os.path.exists(annotations_path):
        annotations = json.load(open(annotations_path, encoding="utf-8"))

    instances = manifest["things"]
    if args.only:
        wanted = tuple(args.only.split(","))
        instances = [t for t in instances if t["id"].startswith(wanted)]
        if not instances:
            raise SystemExit(f"--only {args.only} selected no Things")

    # --- ids ---------------------------------------------------------------
    id_map: dict[str, str] = {}
    taken: set[str] = set()
    collisions: list[tuple[str, str]] = []
    for thing in instances:
        base = normalize_thing_id(thing["id"])
        candidate = base
        ordinal = 2
        while candidate in taken:
            candidate = f"{base}-{ordinal}"
            ordinal += 1
        if candidate != base:
            collisions.append((thing["id"], candidate))
        taken.add(candidate)
        id_map[thing["id"]] = candidate

    def resolve(reference: str) -> str:
        if reference in id_map:
            return id_map[reference]
        # A reference into a Thing the subset left out still has to name
        # something; keep the slug so the manifest stays readable and the
        # missing Thing is reported rather than silently renamed.
        return normalize_thing_id(reference)

    # --- models ------------------------------------------------------------
    model_files = {
        os.path.basename(p)[: -len(".tm.json")]: json.load(open(p, encoding="utf-8"))
        for p in sorted(
            os.path.join(src, "things", f)
            for f in os.listdir(os.path.join(src, "things"))
        )
    }

    by_model: dict[str, list[dict]] = collections.defaultdict(list)
    for thing in instances:
        by_model[thing["thingModel"]].append(thing)

    # A Thing whose Actions differ per instance cannot share a model: wot-lab
    # compiles effects from the model's Thing Description, and an environment
    # pins state and links, never affordances. Such instances each get a model.
    per_instance: set[str] = set(
        args.per_instance.split(",") if args.per_instance else []
    )

    annotation_prefixes = used_prefixes(
        {
            key: value
            for record in annotations.values()
            for key, value in record.items()
            if key in ANNOTATION_KEYS
        }
    )

    written_models: list[str] = []
    model_of_instance: dict[str, str] = {}
    model_tds: dict[str, dict] = {}

    def instance_td(original_id: str) -> dict | None:
        path = os.path.join(src, "tds", f"{original_id}.td.json")
        if not os.path.exists(path):
            return None
        return json.load(open(path, encoding="utf-8"))

    for model_name, things in sorted(by_model.items()):
        source_tm = model_files[model_name]
        if model_name in per_instance:
            for thing in things:
                expanded = instance_td(thing["id"])
                if expanded is None:
                    raise SystemExit(
                        f"{thing['id']}: '{model_name}' needs per-instance actions "
                        "but no expanded Thing Description is in tds/"
                    )
                name = f"{args.prefix}-{normalize_thing_id(thing['id'])}"
                td = build_model_td(
                    source_tm,
                    expanded.get("actions") or {},
                    resolve,
                    name,
                    annotation_prefixes,
                )
                td["title"] = expanded.get("title") or td.get("title") or name
                directory = os.path.join(THINGS_DIR, name)
                if os.path.isdir(directory):
                    shutil.rmtree(directory)
                write_json(os.path.join(directory, f"{name}.td.json"), td)
                write_json(
                    os.path.join(directory, "state.json"),
                    rewrite_value(states[thing["id"]], resolve),
                )
                written_models.append(name)
                model_tds[name] = td
                model_of_instance[thing["id"]] = name
        else:
            name = f"{args.prefix}-{model_name}"
            td = build_model_td(
                source_tm,
                source_tm.get("actions") or {},
                resolve,
                name,
                annotation_prefixes,
            )
            directory = os.path.join(THINGS_DIR, name)
            if os.path.isdir(directory):
                shutil.rmtree(directory)
            write_json(os.path.join(directory, f"{name}.td.json"), td)
            write_json(
                os.path.join(directory, "state.json"),
                most_common_state(
                    [rewrite_value(states[t["id"]], resolve) for t in things],
                    td.get("properties") or {},
                ),
            )
            written_models.append(name)
            model_tds[name] = td
            for thing in things:
                model_of_instance[thing["id"]] = name

    # --- manifest ----------------------------------------------------------
    env_things = []
    for thing in instances:
        original = thing["id"]
        entry: dict = {
            "model": model_of_instance[original],
            "id": id_map[original],
            "title": thing.get("title") or original,
            "state": rewrite_value(states[original], resolve),
        }
        annotation = {
            key: value
            for key, value in (annotations.get(original) or {}).items()
            if key in ANNOTATION_KEYS
        }
        if annotation:
            entry["td"] = annotation
        env_things.append(entry)

    env = {
        "name": args.name,
        "description": args.description,
        "things": env_things,
    }
    # One layout for every manifest, whether hand-written or generated.
    with open(os.path.join(ENVS_DIR, f"{args.name}.json"), "w", encoding="utf-8") as out:
        out.write(dump_manifest(env))
    write_sidecars(args, src, id_map, model_of_instance, model_tds)

    # --- report ------------------------------------------------------------
    print(f"{args.name}: {len(env_things)} Things from {len(written_models)} models")
    for name in written_models[:12]:
        print(f"  model  src/things/{name}/")
    if len(written_models) > 12:
        print(f"  ... and {len(written_models) - 12} more")
    if collisions:
        print(f"  {len(collisions)} id(s) disambiguated after slugification:")
        for original, new in collisions:
            print(f"    {original} -> {new}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", help="a tee-wip environments/<name> directory")
    parser.add_argument("--prefix", required=True, help="Thing Model name prefix")
    parser.add_argument("--name", required=True, help="environment name to write")
    parser.add_argument("--description", default="", help="manifest description")
    parser.add_argument(
        "--per-instance",
        default="",
        help="comma-separated models whose Actions differ per instance",
    )
    parser.add_argument(
        "--only",
        default="",
        help="comma-separated id prefixes; convert only matching Things",
    )
    convert(parser.parse_args())


if __name__ == "__main__":
    main()
