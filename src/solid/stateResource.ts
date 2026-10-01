/**
 * The resource the lab posts to a Solid pod: one WoT interaction as a PROV-O
 * record — the request that arrived, the activity that handled it, and the state
 * that activity left behind.
 *
 * The state is the whole environment, not only the Thing the request addressed.
 * A WoT interaction is not confined to its own Thing: a VRE effect writes across
 * Things (a station consumes the products it builds from), so a record of the
 * addressed Thing alone would show a produce Action that changed nothing. Every
 * record therefore carries one state per running Thing, collected under the single
 * entity the activity generated, and a run reads back as a sequence of complete
 * states rather than a sequence of fragments. Which Thing was *asked* is a fact
 * about the request, and the request carries it — otherwise a reader following the
 * states would find every Thing an equally good answer to "which one?".
 *
 * This module decides *what* a record says; `stateSink.ts` decides where it
 * goes. Turtle rather than JSON because the destination is a pod: a record that
 * arrives as RDF is queryable next to everything else there, and an opaque JSON
 * blob is not.
 *
 * Every term is someone else's: PROV-O for who did what and when, PROV-DICTIONARY
 * for a state's Properties by name, the W3C HTTP vocabulary and Content-in-RDF for
 * the request and its response, the WoT Thing Description and hypermedia
 * vocabularies for the operation and the affordance a request named, FOAF and DCMI
 * Terms for identity and names. The lab mints no vocabulary of its own, so a
 * record needs no documentation but the specifications it is written in — with the
 * one caveat that reading *which* Thing a request addressed still means knowing
 * that this lab puts the Thing's id first in the path.
 *
 * What that costs is a term for `null`: RDF has none, and inventing one is what
 * this module no longer does. At predicate position saying nothing *is* how RDF
 * says absent, so a null Property is left out. Inside a list, where dropping an
 * element would shift every element after it, the place is held by a blank node —
 * which says "an element RDF cannot state", the closest a standard vocabulary
 * gets.
 *
 * The state is otherwise serialised faithfully, so a record reads back as the
 * state it recorded. A Property is a `prov:KeyEntityPair`: `prov:pairKey` for its
 * name and `prov:pairEntity` for its value, which is what PROV defines for a named
 * member and what `td:name` and `jsonschema:propertyName` are not — those name an
 * affordance and a schema, and a recorded value is neither. Arrays stay RDF
 * collections rather than repeated predicates, because a repeated predicate loses
 * their order and order carries meaning in states like a recipe's `inputs`.
 *
 * A structured value becomes a subject of its own, named by a digest of its
 * contents. That is what makes two records comparable: a blank node is a fresh
 * identity in every record, so an unchanged structured value would read as changed
 * in every diff. It also flattens the document, which a nested value did not — the
 * indentation alone made a deep value quadratic in its own depth.
 */
import { createHash } from 'crypto';


/**
 * A Date as an `xsd:dateTime` lexical form, or the epoch when it is not a date.
 *
 * `toISOString` throws on an invalid Date, and these are called while a document
 * is half built — a record with a wrong timestamp is worth more than no record.
 */
function timestamp(value: Date): string {
  return Number.isNaN(value.getTime()) ? new Date(0).toISOString() : value.toISOString();
}

/**
 * The name a value is recorded under: a digest of its own contents.
 *
 * Content-derived rather than minted, so the same value is the same subject in
 * every record. That is what makes a state comparable: two records of an
 * unchanged structured value point at one subject, and a diff that asks whether
 * the value changed gets the right answer without walking it.
 */
function valueName(canonicalForm: string): string {
  return createHash('sha256').update(canonicalForm).digest('hex').slice(0, 16);
}

/** The vocabularies a record is written in, as its prefix header. */
const vocabularies: [string, string][] = [
  ['rdf', 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'],
  ['xsd', 'http://www.w3.org/2001/XMLSchema#'],
  ['prov', 'http://www.w3.org/ns/prov#'],
  ['dcterms', 'http://purl.org/dc/terms/'],
  ['foaf', 'http://xmlns.com/foaf/0.1/'],
  // The prefix a Thing Description binds this namespace to, so a record and a TD
  // spell the HTTP vocabulary the same way.
  ['htv', 'http://www.w3.org/2011/http#'],
  ['httpm', 'http://www.w3.org/2011/http-methods#'],
  ['httpsc', 'http://www.w3.org/2011/http-statusCodes#'],
  ['td', 'https://www.w3.org/2019/wot/td#'],
  // The form a request exercised is hypermedia, not a Thing Description term:
  // `hctl:Form` and `hctl:hasOperationType` live here, and `td:` has no Form.
  ['hctl', 'https://www.w3.org/2019/wot/hypermedia#'],
  // A request body is Content-in-RDF's business: `htv:body`'s range is a
  // `cnt:Content`, and nothing else in either vocabulary carries bytes.
  ['cnt', 'http://www.w3.org/2011/content#'],
];

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
 * The Thing Description individual for each operation, as the TD 1.1 JSON-LD
 * context maps an `op` value — `hctl:hasOperationType td:invokeAction` rather than
 * a string, so a record joins against the Thing Description that declares the
 * form, and says what the interaction was rather than how this lab routed it.
 */
const operationTypes: Record<WotOperation, string> = {
  readproperty: 'td:readProperty',
  writeproperty: 'td:writeProperty',
  readallproperties: 'td:readAllProperties',
  writeallproperties: 'td:writeAllProperties',
  observeproperty: 'td:observeProperty',
  invokeaction: 'td:invokeAction',
  subscribeevent: 'td:subscribeEvent'
};

/**
 * Which kind of affordance the named one is — the operation already says it, and
 * the `all` operations name none, which is why two of these are undefined.
 */
const affordanceClasses: Record<WotOperation, string | undefined> = {
  readproperty: 'td:PropertyAffordance',
  writeproperty: 'td:PropertyAffordance',
  observeproperty: 'td:PropertyAffordance',
  invokeaction: 'td:ActionAffordance',
  subscribeevent: 'td:EventAffordance',
  readallproperties: undefined,
  writeallproperties: undefined
};

/** The property relating a Thing to an affordance of that kind. */
const affordanceProperties: Record<WotOperation, string> = {
  readproperty: 'td:hasPropertyAffordance',
  writeproperty: 'td:hasPropertyAffordance',
  observeproperty: 'td:hasPropertyAffordance',
  invokeaction: 'td:hasActionAffordance',
  subscribeevent: 'td:hasEventAffordance',
  readallproperties: 'td:hasPropertyAffordance',
  writeallproperties: 'td:hasPropertyAffordance'
};

/**
 * The status-code individuals of the HTTP-in-RDF vocabulary, by code. From the
 * vocabulary itself rather than a handful the lab happens to answer with, so a
 * status added later still links instead of silently dropping to the value alone.
 */
const statusCodes: Record<number, string> = {
  100: 'Continue', 101: 'SwitchingProtocols', 102: 'Processing',
  200: 'OK', 201: 'Created', 202: 'Accepted', 203: 'NonAuthoritativeInformation',
  204: 'NoContent', 205: 'ResetContent', 206: 'PartialContent', 207: 'MultiStatus',
  226: 'IMUsed',
  300: 'MultipleChoices', 301: 'MovedPermanently', 302: 'Found', 303: 'SeeOther',
  304: 'NotModified', 305: 'UseProxy', 307: 'TemporaryRedirect',
  400: 'BadRequest', 401: 'Unauthorized', 402: 'PaymentRequired', 403: 'Forbidden',
  404: 'NotFound', 405: 'MethodNotAllowed', 406: 'NotAcceptable',
  407: 'ProxyAuthenticationRequired', 408: 'RequestTimeout', 409: 'Conflict',
  410: 'Gone', 411: 'LengthRequired', 412: 'PreconditionFailed',
  413: 'RequestEntityTooLarge', 414: 'RequestURITooLong', 415: 'UnsupportedMediaType',
  416: 'RequestedRangeNotSatisfiable', 417: 'ExpectationFailed',
  422: 'UnprocessableEntity', 423: 'Locked', 424: 'FailedDependency',
  426: 'UpgradeRequired',
  500: 'InternalServerError', 501: 'NotImplemented', 502: 'BadGateway',
  503: 'ServiceUnavailable', 504: 'GatewayTimeout', 505: 'HTTPVersionNotSupported',
  506: 'VariantAlsoNegotiates', 507: 'InsufficientStorage', 510: 'NotExtended'
};

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
  /** The addressed Thing's URI on this lab, for the request to point at. */
  thingIri: string;
  /**
   * The container in the pod holding this run's records, when the sink groups them.
   *
   * A run and not an environment: the same manifest started twice is the same
   * environment, so grouping by that alone reads a restart as a state change the
   * next request caused. A container rather than a name the lab invents, because a
   * container is a resource that exists — it answers a GET and lists the records
   * that belong to the run.
   */
  runIri?: string;
  /**
   * The `#state` of the record this one follows, as an absolute URI in the pod.
   *
   * Known before this record is written because the lab chooses where each record
   * goes rather than letting the pod mint a name for it — so the link is to a
   * resource that will exist, and nothing has to wait on anything to learn it.
   */
  previousStateIri?: string;
  /**
   * The URI of the environment running when the interaction arrived, when one is.
   * An IRI rather than its name, so a reader can follow it to the manifest the
   * run came from (the lab serves it at `/_lab/environments/<name>`).
   */
  environmentIri?: string;
  /** Every running Thing's state after the interaction was handled, in creation order. */
  things: ThingState[];
}

// eslint-disable-next-line no-control-regex
const controlCharacters = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

export function escapeLiteral(value: string): string {
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

export function isAbsoluteHttpIri(value: string): boolean {
  return /^https?:\/\/\S+$/.test(value) && !illegalInIri.test(value);
}

/** Whether a value can identify a PROV agent as a URI — a WebID, or any IRI. */
export function isAgentIri(value: string): boolean {
  return (isAbsoluteHttpIri(value) || /^urn:\S+$/.test(value)) && !illegalInIri.test(value);
}

/**
 * A value's members, in a stable order, as the bytes its identity is taken from.
 *
 * Object keys are sorted so that two equal values hash equally whichever order
 * their handlers happened to build them in. Anything JSON cannot carry falls back
 * to `undefined`, and an unhashable value is written inline rather than shared.
 */
function canonical(value: unknown): string | undefined {
  try {
    return JSON.stringify(value, (_key, inner) =>
      inner !== null && typeof inner === 'object' && !Array.isArray(inner)
        ? Object.fromEntries(Object.keys(inner as Record<string, unknown>).sort()
          .map(key => [key, (inner as Record<string, unknown>)[key]]))
        : inner);
  } catch {
    return undefined;
  }
}

/**
 * Past this depth a structured value is recorded as present and not expanded.
 *
 * A state is whatever a handler put there, including something recursive enough
 * to exhaust the stack. The cap is far past any value a Thing Description
 * describes, so it bounds the damage without truncating a real state.
 */
const maxValueDepth = 32;

/**
 * The subjects a record hoists out of its states, by the hash that names them.
 *
 * A structured value becomes a subject of its own rather than a blank node nested
 * where it was found. Two reasons: a blank node is a fresh identity in every
 * record, so two records of an unchanged value would disagree about it and read
 * as a change; and nesting cost a line's indentation per level, which made a deep
 * value quadratic in its own depth.
 */
type ValueSubjects = Map<string, string[]>;

/** What has been named so far in this record. */
interface ValueScope {
  subjects: ValueSubjects;
}

/**
 * The subject a value of this digest is written under.
 *
 * A fragment of the record, which makes it a URI the record itself defines: it
 * resolves, because resolving it means fetching this record. The digest is also
 * written as a literal, and that — not the URI — is what makes two records
 * comparable, since the same fragment in two records is two URIs.
 */
function valueSubject(digest: string): string {
  return `<#value-${digest}>`;
}

/**
 * One state value as something `prov:pairEntity` can point at.
 *
 * An atom becomes an entity carrying it as its `prov:value` — which is a
 * `DatatypeProperty`, so only ever a literal. A string that reads as an http(s)
 * IRI becomes that IRI: these records go into a pod to be followed, and a
 * cross-Thing reference that stayed a literal would be a dead end there. A
 * structured value becomes a reference to a subject named after its contents.
 */
function valueEntity(value: unknown, scope: ValueScope, depth = 0): string | undefined {
  const literal = literalTerm(value);
  if (literal !== undefined) {
    return `[ prov:value ${literal} ]`;
  }
  if (typeof value === 'string') {
    // Only reached for a string `literalTerm` declined, i.e. one that is an IRI.
    return iriTerm(value);
  }
  if (value === null || value === undefined || typeof value !== 'object') {
    return undefined;
  }
  // An invalid Date is a value RDF has nothing to say about, like `null` — walking
  // it as a structure would record it as an empty one, which it is not.
  if (value instanceof Date) {
    return undefined;
  }
  if (depth >= maxValueDepth) {
    return '[ a prov:Entity ]';
  }

  const hash = canonical(value);
  const digest = hash === undefined ? undefined : valueName(hash);
  const name = digest === undefined ? undefined : valueSubject(digest);
  if (name !== undefined && scope.subjects.has(name)) {
    return name;
  }
  // Registered before recursing, so a value that contains itself terminates.
  if (name !== undefined) {
    scope.subjects.set(name, []);
  }

  const body = Array.isArray(value)
    ? arrayLines(value, scope, depth)
    : dictionaryLines(value as Record<string, unknown>, scope, depth);
  // The digest as a literal, so a reader comparing this value across records joins
  // on something that is the same in both. The fragment URI is not: it resolves
  // against whichever record it is written in.
  const lines = digest === undefined
    ? body
    : [body[0], `dcterms:identifier "${digest}"`, ...body.slice(1)];

  if (name === undefined) {
    return `[ ${lines.join(' ;\n      ')} ]`;
  }
  scope.subjects.set(name, lines);
  return name;
}

/** The statements of an array value: an RDF collection, so its order survives. */
function arrayLines(value: unknown[], scope: ValueScope, depth: number): string[] {
  if (value.length === 0) {
    // `prov:EmptyCollection` says "a collection without members", which is what an
    // empty array is; a bare `prov:Collection` would only decline to list them.
    return [`a prov:Entity, prov:EmptyCollection`];
  }
  // `Array.from` rather than `map`, which skips holes: a hole would shift every
  // element after it, and the placeholder exists precisely so it cannot. An
  // element RDF has no term for is an entity that says nothing about itself.
  const items = Array.from(value, item => valueEntity(item, scope, depth + 1) ?? '[ a prov:Entity ]');
  // `rdf:value` rather than `prov:value`, which is a `DatatypeProperty` and so
  // cannot carry a list.
  return [`a prov:Entity, prov:Collection`, `rdf:value (\n        ${items.join('\n        ')}\n      )`];
}

/** The statements of a structured value: a PROV dictionary of its members. */
function dictionaryLines(value: Record<string, unknown>, scope: ValueScope, depth: number): string[] {
  const members = pairNodes(value, scope, depth + 1);
  return members.length
    ? [`a prov:Entity, prov:Dictionary`, `prov:hadDictionaryMember\n        ${members.join(' ,\n        ')}`]
    : [`a prov:Entity, prov:EmptyDictionary`];
}

/**
 * One `key = value` member, as the pair PROV defines for exactly this.
 *
 * `prov:pairKey` takes the name and `prov:pairEntity` the value, which is what
 * `prov:KeyEntityPair` is: a name and an entity. The names a Thing Description
 * uses — `td:name`, `jsonschema:propertyName` — are not these: they name an
 * affordance and a schema, and a recorded value is neither.
 */
function pairNodes(values: Record<string, unknown>, scope: ValueScope, depth: number): string[] {
  return Object.entries(values).flatMap(([name, value]) => {
    const entity = valueEntity(value, scope, depth);
    return entity === undefined
      ? []
      : [`[ prov:pairKey "${escapeLiteral(name)}" ; prov:pairEntity ${entity} ]`];
  });
}

/**
 * One atomic value as a Turtle literal, or `undefined` when it is not one.
 *
 * `undefined` for anything RDF has no literal for — `null`, `NaN`, a function, a
 * structured value — which at predicate position is omitted, because there saying
 * nothing *is* how RDF says absent.
 */
function literalTerm(value: unknown): string | undefined {
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return undefined;
    }
    // A bare integer is already xsd:integer in Turtle; everything else is typed
    // explicitly rather than relying on the decimal/double shorthands. Negative
    // zero is a double, because `xsd:integer` has no such value and `String(-0)`
    // would silently record it as `0`.
    if (Object.is(value, -0)) {
      return `"-0"^^xsd:double`;
    }
    return Number.isSafeInteger(value) ? String(value) : `"${value}"^^xsd:double`;
  }
  if (typeof value === 'string') {
    return isAbsoluteHttpIri(value) ? undefined : `"${escapeLiteral(value)}"`;
  }
  // A Date is a point in time, which RDF has a datatype for — recording it as an
  // empty structure would lose it, and as a plain string would lose its meaning.
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : `"${value.toISOString()}"^^xsd:dateTime`;
  }
  // A value that knows how to represent itself is asked, as JSON would ask it.
  if (value !== null && typeof value === 'object' && typeof (value as { toJSON?: unknown }).toJSON === 'function') {
    return literalTerm((value as { toJSON: () => unknown }).toJSON());
  }
  return undefined;
}

/**
 * An IRI as a Turtle term, or `undefined` when the value cannot be one.
 *
 * Every `<...>` in a record goes through here. An unchecked value would not only
 * break the document: a value carrying `>` closes the IRI and whatever follows is
 * parsed as more Turtle, so an unvalidated IRI is a way to write triples into a
 * record from outside it.
 */
function iriTerm(value: string): string | undefined {
  return isAbsoluteHttpIri(value) ? `<${value}>` : undefined;
}

function agentTerm(agent: RequestAgent): string {
  // Checked here rather than trusted from the caller: the gate used to live in the
  // middleware, which left the guarantee one new caller away from being wrong.
  if ('iri' in agent && isAgentIri(agent.iri)) {
    return `<${agent.iri}>`;
  }
  if ('iri' in agent) {
    return `[ a prov:Agent ; dcterms:identifier "${escapeLiteral(agent.iri)}" ]`;
  }
  // A name the client gave itself is a name, which is what `foaf:name` is for. An
  // address it did not give is where the request came from, so it is recorded as a
  // location rather than as something the agent calls itself.
  if ('id' in agent) {
    return `[ a prov:Agent, foaf:Agent ; foaf:name "${escapeLiteral(agent.id)}" ]`;
  }
  return `[ a prov:Agent ; prov:atLocation [ a prov:Location ; dcterms:identifier "${escapeLiteral(agent.address)}" ] ]`;
}

// The methods `httpm:` actually defines. A name outside this set has no
// individual in that namespace, and minting one would put a term that does not
// exist into W3C's namespace — so an extension method is recorded by name only.
const httpMethods = new Set(['CONNECT', 'DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT', 'TRACE']);

const methodToken = /^[A-Za-z]+$/;

/**
 * The method, as a vocabulary individual where one exists and as a name always.
 *
 * Both, because they are read by different readers: `htv:mthd` is what the HTTP
 * vocabulary models, and `htv:methodName` is what a Thing Description writes in
 * a form — so a record joins against a TD only through the latter.
 */
function methodStatement(method: string): string {
  const name = method.toUpperCase();
  // An extension method that is not a token cannot be a prefixed name at all, and
  // one that is a token still only has an individual if `httpm:` defines it — but
  // either way the method itself is recorded, because the name is the fact.
  return methodToken.test(name) && httpMethods.has(name)
    ? `    htv:mthd httpm:${name} ;\n    htv:methodName "${name}"`
    : `    htv:methodName "${escapeLiteral(name)}"`;
}

/** The hash subject one Thing's state is written under. */
function thingStateSubject(id: string): string {
  // Ids are slugs (`normalizeThingId`), so encoding is a no-op for every id the
  // lab mints — it is here so an id from anywhere else cannot break the document.
  // `encodeURIComponent` itself throws on a lone surrogate, which is not an id the
  // lab makes but is one it must not die on.
  try {
    return `<#state-${encodeURIComponent(id)}>`;
  } catch {
    return `<#state-${valueName(id)}>`;
  }
}

/**
 * Render one interaction and the state it left as a Turtle document.
 *
 * Everything hangs off hash subjects of the resource itself (`<#request>`,
 * `<#response>`, `<#interaction>`, `<#form>`, `<#affordance>`, `<#state>`, one
 * `<#state-‹id›>` per Thing and one `<#value-‹digest›>` per structured value), so
 * the pod mints one URI and every subject comes with it — no counter, and no
 * identifier the lab would have to keep unique across restarts.
 *
 * A record is also a document *about* itself: `<>` carries the bundle type, so a
 * container of records can be filtered to the records, and a reader who merges
 * several of them has something per record to tell them apart.
 */
export function provenanceToTurtle(snapshot: StateSnapshot): string {
  const { interaction } = snapshot;
  const statusCode = statusCodes[interaction.status];
  const affordanceClass = affordanceClasses[interaction.operation];
  // Hoisted out of the states as they are walked, then written after them.
  const scope: ValueScope = { subjects: new Map() };
  const thingStates = snapshot.things.map(thing => ({
    thing,
    members: pairNodes(thing.state, scope, 0)
  }));
  // One subject per id: two Things sharing one id would otherwise write one
  // subject carrying both their states, fused past telling apart.
  const seen = new Set<string>();
  const uniqueStates = thingStates.filter(({ thing }) => {
    if (seen.has(thing.id)) {
      return false;
    }
    seen.add(thing.id);
    return true;
  });

  // Each subject is written as a list of statements joined with `;`, so whichever
  // one comes last closes the subject — an optional statement cannot leave a
  // dangling separator behind.
  const subject = (name: string, ...lines: (string | undefined)[]): string[] =>
    [``, name, `${lines.filter(line => line !== undefined).join(' ;\n')} .`];

  const statements = [
    // Padded to the longest prefix, so the namespaces line up in a record someone
    // opens in an editor.
    ...vocabularies.map(([prefix, namespace]) =>
      `@prefix ${`${prefix}:`.padEnd(12)}<${namespace}> .`),

    // The record about itself, so a container can be filtered to its records.
    ...subject(`<>`,
      `    a prov:Bundle`,
      `    prov:generatedAtTime "${timestamp(interaction.endedAt)}"^^xsd:dateTime`),

    ...subject(`<#request>`,
      `    a prov:Entity, htv:Request`,
      methodStatement(interaction.method),
      `    htv:requestURI "${escapeLiteral(interaction.requestUri)}"`,
      `    htv:resp <#response>`,
      // Which Thing the request addressed. Without it the record says only that
      // every Thing in the environment has a state here, with nothing to separate
      // the one that was asked from the ones that merely changed — and a reader
      // following the states would answer "which Thing?" with all of them.
      iriTerm(snapshot.thingIri) ? `    dcterms:subject ${iriTerm(snapshot.thingIri)}` : undefined,
      // The form the request exercised, so the WoT operation survives a change to
      // the lab's routes: `httpm:PUT` on a path is a fact about this HTTP binding,
      // `td:writeProperty` is a fact about the interaction.
      `    dcterms:conformsTo <#form>`,
      // `cnt:` because that is what `htv:body`'s range is. The body is text here
      // rather than the base64 the range names: a record is read by people, and a
      // request a lab recorded is text it already decoded.
      interaction.body === undefined ? undefined : `    htv:body [ a cnt:ContentAsText ; cnt:chars "${escapeLiteral(interaction.body)}" ]`),

    // The response the activity produced, rather than a status on the activity
    // itself: the HTTP vocabulary models a response, and the code it carries is
    // that response's, not the handling's.
    ...subject(`<#response>`,
      `    a prov:Entity, htv:Response`,
      Number.isInteger(interaction.status) ? `    htv:statusCodeValue ${interaction.status}` : undefined,
      statusCode ? `    htv:sc httpsc:${statusCode}` : undefined),

    // `hctl:` and not `td:`: a Form is a hypermedia control, and the Thing
    // Description vocabulary has no Form of its own. `hctl:hasTarget` is a
    // `DatatypeProperty`, so the target is the literal its range asks for.
    ...subject(`<#form>`,
      `    a hctl:Form`,
      `    hctl:hasOperationType ${operationTypes[interaction.operation]}`,
      `    hctl:hasTarget "${escapeLiteral(interaction.requestUri)}"`,
      `    htv:methodName "${escapeLiteral(interaction.method.toUpperCase())}"`),

    // The affordance the form belongs to, when the request named one: the `all`
    // operations address the Thing itself and name none. `td:name` goes here and
    // not on the form or on a value, because an affordance is what it names.
    ...(interaction.affordance && affordanceClass
      ? subject(`<#affordance>`,
        `    a ${affordanceClass}`,
        `    td:name "${escapeLiteral(interaction.affordance)}"`,
        `    td:hasForm <#form>`)
      : []),

    // The affordance hangs off the Thing that offers it, which is how a Thing
    // Description relates the two — and what makes it reachable from the request
    // rather than a subject nothing points at.
    ...(interaction.affordance && affordanceClass && iriTerm(snapshot.thingIri)
      ? subject(iriTerm(snapshot.thingIri) as string,
        `    ${affordanceProperties[interaction.operation]} <#affordance>`)
      : []),

    ...subject(`<#interaction>`,
      `    a prov:Activity`,
      // The agent first: the question a provenance log is read for is who did this.
      interaction.agent ? `    prov:wasAssociatedWith ${agentTerm(interaction.agent)}` : undefined,
      // The request is the whole of what the activity used: it carries the method,
      // the URI and the body, which is everything this record knows about what
      // arrived.
      `    prov:used <#request>`,
      `    prov:generated <#response>, <#state>`,
      `    prov:startedAtTime "${timestamp(interaction.startedAt)}"^^xsd:dateTime`,
      `    prov:endedAtTime   "${timestamp(interaction.endedAt)}"^^xsd:dateTime`),

    // A `prov:Collection` so the members are reachable as what they are — the
    // parts of one state — rather than only through the activity that made them.
    ...subject(`<#state>`,
      `    a prov:Entity, prov:Collection`,
      `    prov:generatedAtTime "${timestamp(interaction.endedAt)}"^^xsd:dateTime`,
      // The run first: the container holding this run's records, which is what
      // separates two runs of one manifest. The environment after it, because a
      // reader asking which scenario this was wants the manifest, not the run.
      snapshot.runIri && iriTerm(snapshot.runIri) ? `    dcterms:isPartOf ${iriTerm(snapshot.runIri)}` : undefined,
      snapshot.environmentIri && iriTerm(snapshot.environmentIri) ? `    dcterms:isPartOf ${iriTerm(snapshot.environmentIri)}` : undefined,
      // The state this one followed: one step back rather than a scan of every
      // record's timestamp, and a URI that resolves to the record it names.
      snapshot.previousStateIri && iriTerm(snapshot.previousStateIri)
        ? `    prov:wasRevisionOf ${iriTerm(snapshot.previousStateIri)}`
        : undefined,
      uniqueStates.length
        ? `    prov:hadMember\n${uniqueStates.map(({ thing }) => `        ${thingStateSubject(thing.id)}`).join(',\n')}`
        : undefined),

    // One subject per Thing, in creation order, so a record reads in the order the
    // environment was brought up and two records of the same environment diff line
    // by line. A state is a specialization of its Thing: the same thing, as this
    // record found it. A `prov:Dictionary`, because a state is its Properties by
    // name and that is the structure PROV has for exactly that.
    ...uniqueStates.flatMap(({ thing, members }) =>
      subject(thingStateSubject(thing.id),
        `    a prov:Entity, prov:Dictionary`,
        iriTerm(thing.iri) ? `    prov:specializationOf ${iriTerm(thing.iri)}` : undefined,
        `    dcterms:identifier "${escapeLiteral(thing.id)}"`,
        members.length ? `    prov:hadDictionaryMember\n        ${members.join(' ,\n        ')}` : undefined)),

    // The structured values the states referred to, written once however many
    // Things and however many members shared them.
    ...[...scope.subjects].flatMap(([name, lines]) =>
      lines.length ? subject(name, ...lines.map(line => `    ${line}`)) : [])
  ];

  return `${statements.join('\n')}\n`;
}

