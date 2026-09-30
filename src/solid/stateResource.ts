/**
 * The resource the lab posts to a Solid pod: a Thing's state as it stands after
 * one WoT interaction, in Turtle.
 *
 * This module decides *what* a state resource says; `stateSink.ts` decides where
 * it goes. Turtle rather than JSON because the destination is a pod: a snapshot
 * that arrives as RDF is queryable next to everything else there, and an
 * opaque JSON blob is not.
 *
 * The state is serialised faithfully, so a snapshot can be read back as the
 * state it recorded: arrays become RDF collections rather than repeated
 * predicates (a repeated predicate would lose their order, and order carries
 * meaning in states like a recipe's `inputs`), nested objects become blank
 * nodes, and `null` is omitted because RDF has no term for it.
 */

/** Vocabulary for the lab's own terms — snapshot, interaction, state. */
export const labNamespace = 'https://wintechis.github.io/wot-lab/ns#';

/**
 * Vocabulary the Thing's Property names are minted into. Separate from
 * `labNamespace` so a Property called `state` or `thing` cannot collide with a
 * term of the snapshot vocabulary itself.
 */
export const propertyNamespace = 'https://wintechis.github.io/wot-lab/ns/property#';

/** The WoT operation a request performed, named as the TD's `op` values are. */
export type WotOperation =
  | 'readproperty'
  | 'writeproperty'
  | 'readallproperties'
  | 'writeallproperties'
  | 'observeproperty'
  | 'invokeaction'
  | 'subscribeevent';

/** The request that produced a snapshot. */
export interface Interaction {
  /** The id the Thing is exposed under. */
  thingId: string;
  operation: WotOperation;
  /** The Property, Action or Event named in the path; absent for the `all` operations. */
  affordance?: string;
  method: string;
  /** The request path, as the client wrote it. */
  target: string;
  status: number;
}

export interface StateSnapshot {
  interaction: Interaction;
  /** The Thing's URI on this lab — the same one its Thing Description is served from. */
  thingIri: string;
  /** The environment running when the interaction arrived, when one is. */
  environment?: string;
  /** The Thing's Property values after the interaction was handled. */
  state: Record<string, unknown>;
  at: Date;
}

function escapeLiteral(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

// The characters Turtle forbids inside <...>. A value carrying one is not a
// usable IRI, so it is written as a plain string literal instead.
const illegalInIri = /[\u0000- <>"{}|^`\\]/;

function isAbsoluteHttpIri(value: string): boolean {
  return /^https?:\/\/\S+$/.test(value) && !illegalInIri.test(value);
}

// Prefixed names are far easier to read than full IRIs, but PN_LOCAL admits only
// a restricted alphabet; anything else is written out in full, percent-encoded.
const prefixableName = /^[A-Za-z][A-Za-z0-9_-]*$/;

function propertyPredicate(name: string): string {
  return prefixableName.test(name)
    ? `prop:${name}`
    : `<${propertyNamespace}${encodeURIComponent(name)}>`;
}

/**
 * One state value as a Turtle term, or `undefined` when RDF has nothing to say
 * about it (`null`, `undefined`, `NaN`, a function).
 *
 * A string that reads as an http(s) IRI is written as one: these snapshots go
 * into a pod to be followed, and a cross-Thing reference that stayed a literal
 * would be a dead end there.
 */
function term(value: unknown, indent: string): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return undefined;
    }
    // A bare integer is already xsd:integer in Turtle; everything else is typed
    // explicitly rather than relying on the decimal/double shorthands. The
    // safe-integer test rather than `isInteger`, because past 2^53 JavaScript
    // prints integers in exponent form, which is not an xsd:integer at all.
    return Number.isSafeInteger(value) ? String(value) : `"${value}"^^xsd:double`;
  }
  if (typeof value === 'string') {
    return isAbsoluteHttpIri(value) ? `<${value}>` : `"${escapeLiteral(value)}"`;
  }
  if (Array.isArray(value)) {
    // A dropped element would shift every element after it, so a value RDF has
    // no term for keeps its place as `lab:null`. At predicate position the same
    // value is omitted instead — there, saying nothing *is* how RDF says absent.
    const items = value.map(item => term(item, `${indent}  `) ?? 'lab:null');
    return items.length ? `(\n${items.map(item => `${indent}  ${item}`).join('\n')}\n${indent})` : '()';
  }
  if (typeof value === 'object') {
    const lines = predicateLines(value as Record<string, unknown>, `${indent}  `);
    return lines.length ? `[\n${lines.join(' ;\n')}\n${indent}]` : '[]';
  }
  return undefined;
}

function predicateLines(values: Record<string, unknown>, indent: string): string[] {
  return Object.entries(values).flatMap(([name, value]) => {
    const object = term(value, indent);
    return object === undefined ? [] : [`${indent}${propertyPredicate(name)} ${object}`];
  });
}

/**
 * Render a snapshot as a Turtle document.
 *
 * Everything is hung off hash subjects of the resource itself (`<#snapshot>`,
 * `<#request>`, `<#state>`), so the pod mints one URI and the three subjects
 * come with it — the snapshot needs no identifier of its own to be referenced.
 */
export function snapshotToTurtle(snapshot: StateSnapshot): string {
  const { interaction } = snapshot;
  const statements = [
    `@prefix xsd:  <http://www.w3.org/2001/XMLSchema#> .`,
    `@prefix prov: <http://www.w3.org/ns/prov#> .`,
    `@prefix lab:  <${labNamespace}> .`,
    `@prefix prop: <${propertyNamespace}> .`,
    ``,
    `<#snapshot>`,
    `    a lab:StateSnapshot, prov:Entity ;`,
    `    prov:generatedAtTime "${snapshot.at.toISOString()}"^^xsd:dateTime ;`,
    `    lab:thing <${snapshot.thingIri}> ;`,
    `    lab:thingId "${escapeLiteral(interaction.thingId)}" ;`,
    ...(snapshot.environment ? [`    lab:environment "${escapeLiteral(snapshot.environment)}" ;`] : []),
    `    lab:trigger <#request> ;`,
    `    lab:state <#state> .`,
    ``,
    `<#request>`,
    `    a lab:Interaction ;`,
    `    lab:operation "${interaction.operation}" ;`,
    ...(interaction.affordance ? [`    lab:affordance "${escapeLiteral(interaction.affordance)}" ;`] : []),
    `    lab:method "${escapeLiteral(interaction.method)}" ;`,
    `    lab:requestTarget "${escapeLiteral(interaction.target)}" ;`,
    `    lab:responseStatus ${interaction.status} .`,
    ``,
    `<#state>`
  ];

  const properties = predicateLines(snapshot.state, '    ');
  statements.push(
    properties.length
      ? `    a lab:ThingState ;\n${properties.join(' ;\n')} .`
      : `    a lab:ThingState .`
  );

  return `${statements.join('\n')}\n`;
}
