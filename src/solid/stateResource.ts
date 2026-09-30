/**
 * The resource the lab posts to a Solid pod: one WoT interaction as a PROV-O
 * record — the request that arrived, the activity that handled it, and the state
 * that activity left behind.
 *
 * The state is the whole environment, not only the Thing the request addressed.
 * A WoT interaction is not confined to its own Thing: a VRE effect writes across
 * Things (a station consumes the products it builds from), so a record of the
 * addressed Thing alone would show a produce Action that changed nothing. Every
 * record therefore carries one `lab:ThingState` per running Thing, collected
 * under the single entity the activity generated, and a run reads back as a
 * sequence of complete states rather than a sequence of fragments.
 *
 * This module decides *what* a record says; `stateSink.ts` decides where it
 * goes. Turtle rather than JSON because the destination is a pod: a record that
 * arrives as RDF is queryable next to everything else there, and an opaque JSON
 * blob is not.
 *
 * PROV-O and the W3C HTTP vocabulary carry the provenance — who did what, when,
 * and with which request — so a log reads the same way as anyone else's
 * provenance. The lab's own vocabulary is left with what PROV has no term for:
 * the WoT operation a request performed, and the Property values that make up a
 * state.
 *
 * The state is serialised faithfully, so a record can be read back as the state
 * it recorded: arrays become RDF collections rather than repeated predicates (a
 * repeated predicate would lose their order, and order carries meaning in states
 * like a recipe's `inputs`), nested objects become blank nodes, and `null` is
 * omitted because RDF has no term for it.
 */

/** Vocabulary for the lab's own terms — operation, state, agent identity. */
export const labNamespace = 'https://wintechis.github.io/wot-lab/ns#';

/**
 * Vocabulary the Thing's Property names are minted into. Separate from
 * `labNamespace` so a Property called `state` or `thing` cannot collide with a
 * term of the record vocabulary itself.
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

/**
 * Who made the request.
 *
 * An agent that names itself with a URI gets that URI: PROV wants agents to be
 * identifiable, and a URI is the only identifier still meaningful outside this
 * lab. Anything else — a bare name, or nothing at all, in which case the
 * connection's address is all there is to go on — becomes a blank node. That
 * still says who, without minting a URI that nothing else would resolve.
 */
export type RequestAgent =
  | { iri: string }
  | { id: string }
  | { address: string };

/** The request that drove one interaction, and what handling it did. */
export interface Interaction {
  /** The id the Thing is exposed under. */
  thingId: string;
  operation: WotOperation;
  /** The Property, Action or Event named in the path; absent for the `all` operations. */
  affordance?: string;
  method: string;
  /** The absolute URI the client addressed. */
  requestUri: string;
  /** The request body as text, when one arrived and could be recorded. */
  body?: string;
  agent?: RequestAgent;
  status: number;
  /** When the request arrived; the activity's start. */
  startedAt: Date;
  /** When the response finished; the activity's end, and the state's birth. */
  endedAt: Date;
}

/** One Thing's Property values — one member of the state a record carries. */
export interface ThingState {
  /** The id the Thing is exposed under. */
  id: string;
  /** The Thing's URI on this lab — the same one its Thing Description is served from. */
  iri: string;
  /** The Property values the interaction left behind. */
  state: Record<string, unknown>;
}

export interface StateSnapshot {
  interaction: Interaction;
  /** The addressed Thing's URI on this lab, for the activity to point at. */
  thingIri: string;
  /** The environment running when the interaction arrived, when one is. */
  environment?: string;
  /** Every running Thing's state after the interaction was handled, in creation order. */
  things: ThingState[];
}

// eslint-disable-next-line no-control-regex
const controlCharacters = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

function escapeLiteral(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    // Everything else a Turtle string cannot carry raw. A request body is not
    // required to be text, and one stray byte must not cost the whole record.
    .replace(controlCharacters, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0').toUpperCase()}`);
}

// The characters Turtle forbids inside <...>. A value carrying one is not a
// usable IRI, so it is written as a plain string literal instead.
// eslint-disable-next-line no-control-regex
const illegalInIri = /[\u0000- <>"{}|^`\\]/;

function isAbsoluteHttpIri(value: string): boolean {
  return /^https?:\/\/\S+$/.test(value) && !illegalInIri.test(value);
}

/** Whether a value can identify a PROV agent as a URI — a WebID, or any IRI. */
export function isAgentIri(value: string): boolean {
  return (isAbsoluteHttpIri(value) || /^urn:\S+$/.test(value)) && !illegalInIri.test(value);
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
 * A string that reads as an http(s) IRI is written as one: these records go into
 * a pod to be followed, and a cross-Thing reference that stayed a literal would
 * be a dead end there.
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

function agentTerm(agent: RequestAgent): string {
  if ('iri' in agent) {
    return `<${agent.iri}>`;
  }
  if ('id' in agent) {
    return `[ a prov:Agent ; lab:agentId "${escapeLiteral(agent.id)}" ]`;
  }
  return `[ a prov:Agent ; lab:ip "${escapeLiteral(agent.address)}" ]`;
}

// Only a token is a method name, and `httpm:` names the ones HTTP defines. An
// extension method that is not a token cannot be a prefixed name at all, so it
// is written with the vocabulary's literal-valued property instead.
const methodToken = /^[A-Za-z]+$/;

function methodStatement(method: string): string {
  return methodToken.test(method)
    ? `    http:mthd httpm:${method.toUpperCase()} ;`
    : `    http:methodName "${escapeLiteral(method)}" ;`;
}

/** The recorded body, as the closing statement of the request subject. */
function bodyStatement(body: string): string {
  return `    http:body [ prov:value "${escapeLiteral(body)}" ] .`;
}

/** The hash subject one Thing's state is written under. */
function thingStateSubject(id: string): string {
  // Ids are slugs (`normalizeThingId`), so encoding is a no-op for every id the
  // lab mints — it is here so an id from anywhere else cannot break the document.
  return `<#state-${encodeURIComponent(id)}>`;
}

/**
 * Render one interaction and the state it left as a Turtle document.
 *
 * Everything hangs off hash subjects of the resource itself (`<#request>`,
 * `<#interaction>`, `<#state>`, one `<#state-‹id›>` per Thing), so the pod mints
 * one URI and every subject comes with it — no counter, and no identifier the lab
 * would have to keep unique across restarts.
 */
export function provenanceToTurtle(snapshot: StateSnapshot): string {
  const { interaction } = snapshot;
  const statements = [
    `@prefix xsd:   <http://www.w3.org/2001/XMLSchema#> .`,
    `@prefix prov:  <http://www.w3.org/ns/prov#> .`,
    `@prefix http:  <http://www.w3.org/2011/http#> .`,
    `@prefix httpm: <http://www.w3.org/2011/http-methods#> .`,
    `@prefix lab:   <${labNamespace}> .`,
    `@prefix prop:  <${propertyNamespace}> .`,
    ``,
    `<#request>`,
    `    a prov:Entity, http:Request ;`,
    methodStatement(interaction.method),
    // The body is the last statement when there is one, so the subject closes on
    // whichever of the two comes last.
    ...(interaction.body === undefined
      ? [`    http:requestURI "${escapeLiteral(interaction.requestUri)}" .`]
      : [`    http:requestURI "${escapeLiteral(interaction.requestUri)}" ;`, bodyStatement(interaction.body)]),
    ``,
    `<#interaction>`,
    `    a prov:Activity ;`,
    // The agent first: the question a provenance log is read for is who did this.
    ...(interaction.agent ? [`    prov:wasAssociatedWith ${agentTerm(interaction.agent)} ;`] : []),
    `    prov:used <#request> ;`,
    `    prov:generated <#state> ;`,
    // Which Thing was addressed is a fact about the activity, not about the
    // state: the state covers every Thing, and only the request named one.
    `    lab:thing <${snapshot.thingIri}> ;`,
    `    lab:thingId "${escapeLiteral(interaction.thingId)}" ;`,
    `    lab:operation "${interaction.operation}" ;`,
    ...(interaction.affordance ? [`    lab:affordance "${escapeLiteral(interaction.affordance)}" ;`] : []),
    // The status is the outcome of what the activity did, and PROV has no term
    // for it.
    `    lab:responseStatus ${interaction.status} ;`,
    `    prov:startedAtTime "${interaction.startedAt.toISOString()}"^^xsd:dateTime ;`,
    `    prov:endedAtTime   "${interaction.endedAt.toISOString()}"^^xsd:dateTime .`,
    ``,
    `<#state>`
  ];

  // Written as one list and joined, rather than line by line with a trailing
  // `;`, because an empty lab has to close the subject too.
  const stateStatements = [
    // A `prov:Collection` so the members are reachable as what they are — the
    // parts of one state — rather than only through the activity that made them.
    `    a prov:Entity, prov:Collection, lab:EnvironmentState`,
    `    prov:generatedAtTime "${interaction.endedAt.toISOString()}"^^xsd:dateTime`,
    ...(snapshot.environment ? [`    lab:environment "${escapeLiteral(snapshot.environment)}"`] : []),
    ...(snapshot.things.length
      ? [`    prov:hadMember\n${snapshot.things.map(thing => `        ${thingStateSubject(thing.id)}`).join(',\n')}`]
      : [])
  ];
  statements.push(`${stateStatements.join(' ;\n')} .`);

  // One subject per Thing, in creation order, so a record reads in the order the
  // environment was brought up and two records of the same environment diff line
  // by line.
  for (const thing of snapshot.things) {
    const thingStatements = [
      `    a prov:Entity, lab:ThingState`,
      `    lab:thing <${thing.iri}>`,
      `    lab:thingId "${escapeLiteral(thing.id)}"`,
      ...predicateLines(thing.state, '    ')
    ];
    statements.push(``, thingStateSubject(thing.id), `${thingStatements.join(' ;\n')} .`);
  }

  return `${statements.join('\n')}\n`;
}
