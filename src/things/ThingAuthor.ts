import * as WoT from 'wot-typescript-definitions';
import { mkdir, mkdtemp, rename, rm } from 'fs/promises';
import { dirname, join } from 'path';
import { createLoggers } from '../utils/debug.js';
import { authoringDirectory, readThingModel } from './ThingHandler.js';
import { vreEffectsToHandlers } from './vre.js';

const { debug } = createLoggers('things');

/**
 * Path segments the HTTP surface already owns. A Thing Model may not take one,
 * or its Things' URLs would be shadowed by the lab API or the built frontend.
 */
export const reservedNames = ['_lab', 'assets'];

export type DataType = 'boolean' | 'integer' | 'number' | 'string' | 'object' | 'array';

/**
 * One node of a declared datatype.
 *
 * The same shape describes a Thing property, a member of an object, an array's
 * item type, an action's input parameter or output, and an event's payload —
 * because in a Thing Description they are all the same thing: a data schema.
 * `properties` and `items` make it recursive, so an object can hold objects.
 */
export interface SchemaSpec {
  /** Named where the parent is an object (or the Thing); absent for array items. */
  name?: string;
  type: DataType;
  title?: string;
  description?: string;
  unit?: string;
  readOnly?: boolean;
  observable?: boolean;
  /** Scalars only: the value written into state.json. */
  initial?: unknown;
  /** `type: 'object'` — the members, in declaration order. */
  properties?: SchemaSpec[];
  /** `type: 'array'` — the item type. */
  items?: SchemaSpec;
}

export type PropertySpec = SchemaSpec & { name: string };

export interface ActionSpec {
  name: string;
  title?: string;
  description?: string;
  input?: SchemaSpec[];
  output?: SchemaSpec;
  /** VRE effect program, stored in the TD as `vre:effects`. */
  effects?: string;
}

export interface EventSpec {
  name: string;
  title?: string;
  description?: string;
  /** The payload the event carries. */
  data?: SchemaSpec;
}

export interface ThingSpec {
  name: string;
  title: string;
  description?: string;
  properties: PropertySpec[];
  actions: ActionSpec[];
  events: EventSpec[];
}

/** The files that will be written for a new Thing Model. */
export interface ThingDraft {
  name: string;
  td: Record<string, unknown>;
  state: Record<string, unknown>;
}

const identifier = /^[A-Za-z_]\w*$/;
const typeName = /^[a-z][a-z0-9-]*$/;

/**
 * The value a scalar starts life with.
 *
 * An initial value arrives as text from a form field, so it is converted to the
 * declared type here. A value that will not convert is passed through as typed
 * rather than quietly becoming 0 — validation then rejects it by name, which is
 * far more useful than a Thing that starts with a number nobody asked for.
 */
function scalarDefault(spec: SchemaSpec): unknown {
  const raw = spec.initial;
  if (raw === undefined || raw === '') {
    return spec.type === 'boolean' ? false : spec.type === 'string' ? '' : 0;
  }
  if (spec.type === 'boolean') {
    return typeof raw === 'boolean' ? raw : String(raw) === 'true';
  }
  if (spec.type === 'number' || spec.type === 'integer') {
    const parsed = typeof raw === 'number' ? raw : Number(String(raw).trim());
    if (!Number.isFinite(parsed)) {
      return raw;
    }
    return spec.type === 'integer' ? Math.trunc(parsed) : parsed;
  }
  return String(raw);
}

function defaultValue(spec: SchemaSpec): unknown {
  if (spec.type === 'object') {
    return Object.fromEntries(
      (spec.properties ?? [])
        .filter((member) => member.name)
        .map((member) => [member.name as string, defaultValue(member)])
    );
  }
  // An array starts empty: an item type says what may go in it, not what is.
  if (spec.type === 'array') {
    return [];
  }
  return scalarDefault(spec);
}

function omitEmpty<T extends Record<string, unknown>>(node: T): T {
  return Object.fromEntries(
    Object.entries(node).filter(([, value]) => value !== undefined && value !== '')
  ) as T;
}

/** Compile one datatype node into its Thing Description schema. */
function schemaFromSpec(spec: SchemaSpec, isProperty = false): Record<string, unknown> {
  const node: Record<string, unknown> = omitEmpty({
    title: spec.title,
    type: spec.type,
    description: spec.description,
    unit: spec.unit
  });

  if (isProperty) {
    // Observable by default: a virtual device whose state cannot be watched
    // live is the less useful default in a lab, and the UI leans on it.
    node.observable = spec.observable !== false;
    node.readOnly = spec.readOnly === true;
  }

  if (spec.type === 'object') {
    const members = (spec.properties ?? []).filter((member) => member.name);
    node.properties = Object.fromEntries(
      members.map((member) => [member.name as string, schemaFromSpec(member)])
    );
    if (members.length) {
      node.required = members.map((member) => member.name as string);
    }
  }

  if (spec.type === 'array') {
    node.items = schemaFromSpec(spec.items ?? { type: 'string' });
  }

  return node;
}

/**
 * Turn a form-shaped spec into the two files a Thing is made of.
 *
 * Behavior is emitted as `vre:effects` on the action affordance rather than as
 * JavaScript: the effect program is a constrained
 * grammar that the server compiles and can report errors for, so nothing the
 * browser sends is ever executed as code.
 */
export function buildDraft(spec: ThingSpec): ThingDraft {
  const properties: Record<string, unknown> = {};
  const state: Record<string, unknown> = {};

  for (const property of spec.properties) {
    properties[property.name] = schemaFromSpec(property, true);
    state[property.name] = defaultValue(property);
  }

  const actions: Record<string, unknown> = {};
  for (const action of spec.actions) {
    const params = (action.input ?? []).filter((param) => param.name);
    actions[action.name] = omitEmpty({
      title: action.title,
      description: action.description,
      // Named parameters need an object schema: that is what lets a VRE effect
      // refer to a parameter by name rather than by position.
      input: params.length
        ? {
          type: 'object',
          properties: Object.fromEntries(
            params.map((param) => [param.name as string, schemaFromSpec(param)])
          ),
          required: params.map((param) => param.name as string)
        }
        : undefined,
      output: action.output ? schemaFromSpec(action.output) : undefined,
      'vre:effects': action.effects?.trim() || undefined
    });
  }

  const events: Record<string, unknown> = {};
  for (const event of spec.events) {
    events[event.name] = omitEmpty({
      title: event.title,
      description: event.description,
      data: event.data ? schemaFromSpec(event.data) : undefined
    });
  }

  const td: Record<string, unknown> = omitEmpty({
    '@context': [
      'https://www.w3.org/2019/wot/td/v1',
      'https://www.w3.org/2022/wot/td/v1.1'
    ],
    title: spec.title,
    description: spec.description
  });
  if (Object.keys(properties).length) {
    td.properties = properties;
  }
  if (Object.keys(actions).length) {
    td.actions = actions;
  }
  if (Object.keys(events).length) {
    td.events = events;
  }

  return { name: spec.name, td, state };
}

type TdSchema = { type?: string; properties?: Record<string, TdSchema>; items?: TdSchema };

const dataTypes = ['boolean', 'integer', 'number', 'string', 'object', 'array'];

/**
 * Walk a declared datatype, checking the parts a Thing cannot work without.
 *
 * The recursion is the point: a nested member with no type is exactly as broken
 * as a top-level property with no type, and reports as its own path so the
 * message says which one.
 */
function validateSchemaNode(node: unknown, label: string, errors: string[]): void {
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    errors.push(`${label} is not a schema.`);
    return;
  }

  const schema = node as TdSchema;
  if (typeof schema.type !== 'string') {
    errors.push(`${label} needs a type.`);
    return;
  }
  if (!dataTypes.includes(schema.type)) {
    errors.push(`${label} has an unknown type '${schema.type}'.`);
    return;
  }

  if (schema.type === 'object') {
    const members = schema.properties;
    if (members !== undefined && (typeof members !== 'object' || members === null || Array.isArray(members))) {
      errors.push(`${label} declares properties that are not an object.`);
      return;
    }
    for (const [name, member] of Object.entries(members ?? {})) {
      if (!name.trim()) {
        errors.push(`${label} has a member with no name.`);
      }
      validateSchemaNode(member, `${label} → '${name}'`, errors);
    }
  }

  if (schema.type === 'array') {
    // An array with no item type says nothing about what it holds, and the
    // dashboard has no way to render or edit it.
    if (schema.items === undefined) {
      errors.push(`${label} is an array but declares no item type.`);
      return;
    }
    validateSchemaNode(schema.items, `${label} items`, errors);
  }
}

/**
 * Check a property's starting value against its declared type.
 *
 * Initial values are typed into a text field, so "abc" for an integer is an
 * easy mistake; caught here it names the property, rather than becoming a
 * silently coerced 0 or a string sitting where a number belongs.
 */
function validateInitialValue(schema: TdSchema, value: unknown, label: string, errors: string[]): void {
  const type = schema?.type;
  if (type === 'integer' && !Number.isInteger(value)) {
    errors.push(`${label} must be an integer.`);
  } else if (type === 'number' && typeof value !== 'number') {
    errors.push(`${label} must be a number.`);
  } else if (type === 'boolean' && typeof value !== 'boolean') {
    errors.push(`${label} must be true or false.`);
  } else if (type === 'string' && typeof value !== 'string') {
    errors.push(`${label} must be a string.`);
  } else if (type === 'array' && !Array.isArray(value)) {
    errors.push(`${label} must be an array.`);
  } else if (type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      errors.push(`${label} must be an object.`);
      return;
    }
    for (const [name, member] of Object.entries(schema.properties ?? {})) {
      const nested = (value as Record<string, unknown>)[name];
      if (nested === undefined) {
        errors.push(`${label} has no value for '${name}'.`);
      } else {
        validateInitialValue(member, nested, `${label} → '${name}'`, errors);
      }
    }
  }
}

/**
 * Everything that must hold before a Thing reaches disk, checked in one place
 * so the browser and the HTTP API cannot disagree about what is valid.
 */
export async function validateDraft(draft: ThingDraft): Promise<string[]> {
  const errors: string[] = [];
  const { name, td, state } = draft;

  if (!typeName.test(name)) {
    errors.push('Name must start with a letter and use only lowercase letters, digits and hyphens.');
  } else if (name.length > 63) {
    errors.push('Name must be 63 characters or fewer.');
  } else if (reservedNames.includes(name)) {
    errors.push(`'${name}' is reserved.`);
  } else if (await readThingModel(name)) {
    // Checked across every catalog root, not just where this one would land:
    // a name that already resolves would be shadowed or would shadow, and
    // either way two models would answer to one name.
    errors.push(`A Thing Model named '${name}' already exists.`);
  }

  if (typeof td.title !== 'string' || !td.title.trim()) {
    errors.push('Thing Description needs a title.');
  }

  if (state === null || typeof state !== 'object' || Array.isArray(state)) {
    errors.push('State must be a JSON object.');
    return errors;
  }

  const properties = (td.properties ?? {}) as Record<string, TdSchema>;
  for (const [propertyName, schema] of Object.entries(properties)) {
    if (!identifier.test(propertyName)) {
      errors.push(`Property '${propertyName}' is not a usable identifier.`);
    }
    validateSchemaNode(schema, `Property '${propertyName}'`, errors);
    // Without logic.js the read handlers are generated as `state[name]`, so a
    // property with no state key reads undefined forever. This is the failure
    // that is hardest to spot at runtime, so it is refused up front.
    if (!Object.prototype.hasOwnProperty.call(state, propertyName)) {
      errors.push(`State has no initial value for property '${propertyName}'.`);
    } else {
      validateInitialValue(schema, state[propertyName], `Initial value for '${propertyName}'`, errors);
    }
  }

  const actions = (td.actions ?? {}) as Record<string, { input?: TdSchema; output?: TdSchema }>;
  for (const [actionName, action] of Object.entries(actions)) {
    if (!identifier.test(actionName)) {
      errors.push(`Action '${actionName}' is not a usable identifier.`);
    }
    if (action?.input) {
      validateSchemaNode(action.input, `Input of action '${actionName}'`, errors);
    }
    if (action?.output) {
      validateSchemaNode(action.output, `Output of action '${actionName}'`, errors);
    }
  }

  const events = (td.events ?? {}) as Record<string, { data?: TdSchema }>;
  for (const [eventName, event] of Object.entries(events)) {
    if (!identifier.test(eventName)) {
      errors.push(`Event '${eventName}' is not a usable identifier.`);
    }
    if (event?.data) {
      validateSchemaNode(event.data, `Data of event '${eventName}'`, errors);
    }
  }

  // Compile the effect programs exactly as the loader will. VRE's own errors
  // are specific ("effect target 'x' is not a Thing property"), so they are
  // surfaced verbatim — and nothing is written until they compile.
  try {
    vreEffectsToHandlers(td as WoT.ThingDescription);
  } catch (cause) {
    errors.push(cause instanceof Error ? cause.message : String(cause));
  }

  return errors;
}

/**
 * Write a validated draft — a new Thing Model — into `src/things/<name>/`.
 *
 * The files are staged outside the Things directory and moved into place with a
 * single rename, so a half-written Thing is never visible to the catalog.
 */
export async function writeDraft(draft: ThingDraft): Promise<string> {
  const root = authoringDirectory();
  const target = join(root, draft.name);
  // Staged as a sibling of the catalog root so the move is a rename within one
  // filesystem, and so the half-written directory is never inside the catalog.
  await mkdir(root, { recursive: true });
  const staging = await mkdtemp(join(dirname(root), '.thing-'));

  try {
    await Bun.write(
      join(staging, `${draft.name}.td.json`),
      `${JSON.stringify(draft.td, null, 4)}\n`
    );
    await Bun.write(
      join(staging, 'state.json'),
      `${JSON.stringify(draft.state, null, 4)}\n`
    );
    await mkdir(dirname(target), { recursive: true });
    await rename(staging, target);
  } catch (cause) {
    await rm(staging, { recursive: true, force: true });
    throw cause;
  }

  debug(`Wrote Thing Model '${draft.name}' to ${target}`);
  return target;
}

/**
 * Remove a Thing Model's directory from disk.
 *
 * Only a model in the authoring directory can be deleted. A model that ships
 * with the lab is part of the release, not data: deleting it would be undone by
 * the next deploy, and would look like data loss until then.
 */
export async function deleteThingModel(name: string): Promise<void> {
  if (!typeName.test(name) || reservedNames.includes(name)) {
    throw new Error(`Refusing to delete '${name}'`);
  }
  const model = await readThingModel(name);
  if (model && !model.writable) {
    throw new Error(`'${name}' ships with the lab and cannot be deleted`);
  }
  await rm(join(authoringDirectory(), name), { recursive: true, force: true });
  debug(`Deleted Thing Model '${name}'`);
}
