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
 * Every term is someone else's: PROV-O for who did what and when, the W3C HTTP
 * vocabulary for the request and its response, the W3C WoT Thing Description and
 * hypermedia vocabularies for the operation and the affordance it named, FOAF and
 * DCMI Terms for identity and names. The lab mints no vocabulary of its own, so a
 * record needs no documentation but the specifications it is written in.
 *
 * What that costs is a term for `null`: RDF has none, and inventing one is what
 * this module no longer does. At predicate position saying nothing *is* how RDF
 * says absent, so a null Property is left out. Inside a list, where dropping an
 * element would shift every element after it, the place is held by a blank node —
 * which says "an element RDF cannot state", the closest a standard vocabulary
 * gets.
 *
 * The state is otherwise serialised faithfully, so a record reads back as the
 * state it recorded: arrays become RDF collections rather than repeated
 * predicates (a repeated predicate would lose their order, and order carries
 * meaning in states like a recipe's `inputs`), and a structured value becomes a
 * collection of named members — `td:name` for a Thing's own Property, which is
 * what a Thing Description calls an affordance's name, and
 * `jsonschema:propertyName` for a member inside a structured value, which is what
 * a Thing Description calls an object member's name.
 */

/** The vocabularies a record is written in, as its prefix header. */
const vocabularies: [string, string][] = [
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
  ['hctl', 'https://www.w3.org/2019/wot/hypermedia#'],
  ['jsonschema', 'https://www.w3.org/2019/wot/json-schema#']
];

/**
 * The Thing Description individual for each operation, as the TD 1.1 JSON-LD
 * context maps an `op` value — `hctl:hasOperationType td:invokeAction` rather
 * than a string, so a record joins against the Thing Description that declares
 * the form.
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
    // A dropped element would shift every element after it, so an element RDF has
    // no term for keeps its place as a blank node. At predicate position the same
    // value is omitted instead — there, saying nothing *is* how RDF says absent.
    const items = value.map(item => term(item, `${indent}  `) ?? '[]');
    return items.length ? `(\n${items.map(item => `${indent}  ${item}`).join('\n')}\n${indent})` : '()';
  }
  if (typeof value === 'object') {
    // A structured value is a collection of named members, named the way a Thing
    // Description names an object's members.
    const members = memberNodes(value as Record<string, unknown>, 'jsonschema:propertyName', `${indent}    `);
    return members.length
      ? `[ a prov:Collection ; prov:hadMember\n${members.map(member => `${indent}    ${member}`).join(' ,\n')}\n${indent}  ]`
      : '[ a prov:Collection ]';
  }
  return undefined;
}

/**
 * One `name = value` pair of a state, as a node carrying both.
 *
 * `nameTerm` is the property that names it: `td:name` for a Thing's own Property,
 * `jsonschema:propertyName` for a member inside a structured value. Both are
 * defined as indexing properties — the term a Thing Description itself uses to
 * record the name something was serialised under — which is exactly this.
 */
function memberNodes(values: Record<string, unknown>, nameTerm: string, indent: string): string[] {
  return Object.entries(values).flatMap(([name, value]) => {
    const object = term(value, indent);
    return object === undefined
      ? []
      : [`[ ${nameTerm} "${escapeLiteral(name)}" ; prov:value ${object} ]`];
  });
}

function agentTerm(agent: RequestAgent): string {
  if ('iri' in agent) {
    return `<${agent.iri}>`;
  }
  // A name the client gave itself is a name, which is what `foaf:name` is for. An
  // address it did not give is where the request came from, so it is recorded as a
  // location rather than as something the agent calls itself.
  if ('id' in agent) {
    return `[ a prov:Agent, foaf:Agent ; foaf:name "${escapeLiteral(agent.id)}" ]`;
  }
  return `[ a prov:Agent ; prov:atLocation [ a prov:Location ; dcterms:identifier "${escapeLiteral(agent.address)}" ] ]`;
}

// Only a token is a method name, and `httpm:` names the ones HTTP defines. An
// extension method that is not a token cannot be a prefixed name at all, so it
// is written with the vocabulary's literal-valued property instead.
const methodToken = /^[A-Za-z]+$/;

function methodStatement(method: string): string {
  return methodToken.test(method)
    ? `    htv:mthd httpm:${method.toUpperCase()}`
    : `    htv:methodName "${escapeLiteral(method)}"`;
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
 * `<#response>`, `<#interaction>`, `<#form>`, `<#affordance>`, `<#state>`, one
 * `<#state-‹id›>` per Thing), so the pod mints one URI and every subject comes
 * with it — no counter, and no identifier the lab would have to keep unique
 * across restarts.
 */
export function provenanceToTurtle(snapshot: StateSnapshot): string {
  const { interaction } = snapshot;
  const statusCode = statusCodes[interaction.status];
  const affordanceClass = affordanceClasses[interaction.operation];
  // A form's target is an IRI, so a request URI that is not usable as one is left
  // to `htv:requestURI`, which records it as the literal it is.
  const target = isAbsoluteHttpIri(interaction.requestUri) ? `<${interaction.requestUri}>` : undefined;

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

    ...subject(`<#request>`,
      `    a prov:Entity, htv:Request`,
      methodStatement(interaction.method),
      `    htv:requestURI "${escapeLiteral(interaction.requestUri)}"`,
      `    htv:resp <#response>`,
      interaction.body === undefined ? undefined : `    htv:body [ prov:value "${escapeLiteral(interaction.body)}" ]`),

    // The response the activity produced, rather than a status on the activity
    // itself: the HTTP vocabulary models a response, and the code it carries is
    // that response's, not the handling's.
    ...subject(`<#response>`,
      `    a prov:Entity, htv:Response`,
      `    htv:statusCodeValue ${interaction.status}`,
      statusCode ? `    htv:sc httpsc:${statusCode}` : undefined),

    ...subject(`<#interaction>`,
      `    a prov:Activity`,
      // The agent first: the question a provenance log is read for is who did this.
      interaction.agent ? `    prov:wasAssociatedWith ${agentTerm(interaction.agent)}` : undefined,
      // The addressed Thing and the affordance are what the activity used, beside
      // the request itself. Which Thing was addressed is a fact about the activity,
      // not about the state: the state covers every Thing, and only the request
      // named one.
      `    prov:used ${[`<#request>`, `<#form>`, ...(interaction.affordance && affordanceClass ? [`<#affordance>`] : []), `<${snapshot.thingIri}>`].join(', ')}`,
      `    prov:generated <#response>, <#state>`,
      `    prov:startedAtTime "${interaction.startedAt.toISOString()}"^^xsd:dateTime`,
      `    prov:endedAtTime   "${interaction.endedAt.toISOString()}"^^xsd:dateTime`),

    // The form the request exercised. `hctl:hasOperationType` belongs to a form,
    // which is also where a Thing Description puts the target and the method — so
    // the operation is recorded in the shape the TD it came from uses.
    ...subject(`<#form>`,
      `    a hctl:Form`,
      `    hctl:hasOperationType ${operationTypes[interaction.operation]}`,
      target ? `    hctl:hasTarget ${target}` : undefined,
      methodToken.test(interaction.method) ? `    htv:methodName "${interaction.method.toUpperCase()}"` : undefined),

    // The affordance the form belongs to, when the request named one: the `all`
    // operations address the Thing itself, and there is no affordance to name.
    ...(interaction.affordance && affordanceClass
      ? subject(`<#affordance>`,
        `    a ${affordanceClass}`,
        `    td:name "${escapeLiteral(interaction.affordance)}"`,
        `    td:hasForm <#form>`)
      : []),

    // A `prov:Collection` so the members are reachable as what they are — the
    // parts of one state — rather than only through the activity that made them.
    ...subject(`<#state>`,
      `    a prov:Entity, prov:Collection`,
      `    prov:generatedAtTime "${interaction.endedAt.toISOString()}"^^xsd:dateTime`,
      snapshot.environmentIri ? `    dcterms:isPartOf <${snapshot.environmentIri}>` : undefined,
      snapshot.things.length
        ? `    prov:hadMember\n${snapshot.things.map(thing => `        ${thingStateSubject(thing.id)}`).join(',\n')}`
        : undefined),

    // One subject per Thing, in creation order, so a record reads in the order the
    // environment was brought up and two records of the same environment diff line
    // by line. A state is a specialization of its Thing: the same thing, as this
    // record found it.
    ...snapshot.things.flatMap(thing => {
      const members = memberNodes(thing.state, 'td:name', '        ');
      return subject(thingStateSubject(thing.id),
        `    a prov:Entity, prov:Collection`,
        `    prov:specializationOf <${thing.iri}>`,
        `    dcterms:identifier "${escapeLiteral(thing.id)}"`,
        members.length ? `    prov:hadMember\n${members.map(member => `        ${member}`).join(' ,\n')}` : undefined);
    })
  ];

  return `${statements.join('\n')}\n`;
}
