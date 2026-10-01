/**
 * A product resource's representation: its current state as Turtle.
 *
 * Turtle by default because a product is data about a physical item, and the
 * things that read it are the same things that read the provenance records in the
 * pod — a JSON representation would have to be translated before it could be
 * joined against anything. JSON is still served to a client that asks for it.
 *
 * The shape follows the product passports under `phone resources/`: a lowercase
 * predicate carries each Property, and a Property the model gave a class or a
 * unit becomes a `qudt:QuantityValue` node rather than a bare number, the way a
 * passport writes `ex:ratedCapacity` pointing at a quantity in `unit:MilliA-HR`.
 * An object Property becomes a node of its own, typed by its `@type`, the way a
 * passport's manufacturer is a `schema:Organization` with an address. The classes
 * and units come from the model's own annotations, so the semantics a Thing
 * Description carried survive the product no longer being a Thing.
 *
 * Classes only in type position. Every term the shopfloor vocabulary defines is
 * initial-capital — `arena:XPosition`, `arena:State` — which names a kind of
 * thing, not a way of relating two, so none of them is used as a predicate.
 * Predicates come from the passport namespace, named after the Property they
 * carry: mechanical rather than prettier, so a reader can predict the predicate
 * from the Thing Description and a new model needs no mapping added here. A model
 * that wants a passport's own term — `schema:mpn` — says so with `lab:predicate`.
 *
 * A `qudt:unit` is written only where a model declares one. A unit invented here
 * would be a measurement claim the lab has no basis for — a position on a
 * shopfloor grid is not metres unless someone says so.
 *
 * A product that was produced links the products it was ultimately made from:
 * not the intermediate products a recipe consumed, but the raw inputs at the end
 * of each chain — the parts that went into it — plus `ex:battery` for the battery
 * among them, as a phone passport links its battery.
 */

import { globalState, normalizeThingId } from '../globalState.js';
import { escapeLiteral, isAbsoluteHttpIri } from '../solid/stateResource.js';
import { inputsProperty, isResourceId, PropertyMeta, resourceMeta, ResourceMeta } from './resources.js';

/** The vocabularies a representation is written in, by prefix. */
const namespaces: Record<string, string> = {
  ex: 'https://solidtest.iis.fraunhofer.de/rocky/shapes/passport.vocab.ttl#',
  schema: 'https://schema.org/',
  qudt: 'http://qudt.org/schema/qudt/',
  unit: 'http://qudt.org/vocab/unit/',
  arena: 'https://solid.ti.rw.fau.de/public/ns/arena#',
  xsd: 'http://www.w3.org/2001/XMLSchema#'
};

/** The class a passport gives a battery, which a phone links with `ex:battery`. */
export const batteryClass = 'ex:Battery';

/**
 * The class a finished product carries — the end of a recipe chain rather than an
 * intermediate another recipe consumes. What makes a product worth copying into a
 * pod, and what an order asks for.
 */
export const finishedProductClass = 'ex:Smartphone';

/**
 * One state value as a Turtle literal, or `undefined` when RDF has no literal for
 * it — `null`, which a product carries whenever it has no position, and which at
 * predicate position is said by saying nothing.
 *
 * A fraction is written as a decimal, `3.87`, as the passports write it; only a
 * number decimal notation cannot spell exactly falls back to `xsd:double`.
 */
function literal(value: unknown): string | undefined {
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return undefined;
    }
    if (Number.isSafeInteger(value) && !Object.is(value, -0)) {
      return String(value);
    }
    return /^-?\d+\.\d+$/.test(String(value)) ? String(value) : `"${value}"^^xsd:double`;
  }
  if (typeof value === 'string') {
    return isAbsoluteHttpIri(value) ? `<${value}>` : `"${escapeLiteral(value)}"`;
  }
  return undefined;
}

/** A compact IRI whose prefix this writer declares, safe to write as is. */
function isCompactIri(term: string | undefined): term is string {
  const match = term === undefined ? null : /^([a-z]+):[A-Za-z][A-Za-z0-9_-]*$/.exec(term);
  return match !== null && match[1] in namespaces;
}

/** The predicate a Property is carried by: the model's own, or one named after it. */
function predicateFor(name: string, meta: PropertyMeta | undefined): string | undefined {
  if (isCompactIri(meta?.predicate)) {
    return meta.predicate;
  }
  return /^[A-Za-z][A-Za-z0-9_-]*$/.test(name) ? `ex:${name}` : undefined;
}

interface Statement {
  predicate: string;
  object: string;
}

/** One subject and what is said about it, ready to be written. */
interface Node {
  subject: string;
  classes: string[];
  statements: Statement[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The statements for a set of Property values, and the nodes they point at.
 *
 * `path` names the node the values belong to — empty for the product itself — and
 * every node made here is a fragment named after the path to it, so a
 * manufacturer's address is `<#manufacturer-address>`, as a passport names it.
 */
function describe(
  values: Record<string, unknown>,
  metas: Record<string, PropertyMeta>,
  path: string[],
  nodes: Node[]
): Statement[] {
  const statements: Statement[] = [];
  for (const [name, value] of Object.entries(values)) {
    const meta = metas[name];
    const predicate = predicateFor(name, meta);
    if (predicate === undefined) {
      continue;
    }
    const subject = `<#${[...path, name].join('-')}>`;

    if (isRecord(value)) {
      const node: Node = { subject, classes: meta?.type ? [meta.type] : [], statements: [] };
      nodes.push(node);
      node.statements = describe(value, meta?.properties ?? {}, [...path, name], nodes);
      statements.push({ predicate, object: subject });
      continue;
    }

    const object = literal(value);
    if (object === undefined) {
      continue;
    }
    // A Property the model classified or gave a unit, holding a number, becomes a
    // quantity node: the class and unit say what the number is, which a bare
    // literal cannot.
    if (typeof value === 'number' && (meta?.type !== undefined || meta?.unit !== undefined)) {
      const quantity: Statement[] = [{ predicate: 'qudt:numericValue', object }];
      if (isCompactIri(meta.unit)) {
        quantity.push({ predicate: 'qudt:unit', object: meta.unit });
      }
      nodes.push({
        subject,
        classes: [...(meta.type ? [meta.type] : []), 'qudt:QuantityValue'],
        statements: quantity
      });
      statements.push({ predicate, object: subject });
      continue;
    }
    statements.push({ predicate, object });
  }
  return statements;
}

/** Another product's state and metadata, as the HTTP surface knows them. */
// eslint-disable-next-line no-unused-vars
export type ResourceLookup = (id: string) => { state: Record<string, unknown>; meta?: ResourceMeta } | undefined;

/** The ids a product's state says it was made from. */
function inputsOf(state: Record<string, unknown>): string[] {
  const inputs = state[inputsProperty];
  return Array.isArray(inputs) ? inputs.filter((input): input is string => typeof input === 'string') : [];
}

/**
 * The raw inputs a product was made from, and the batteries among everything that
 * went into it.
 *
 * Follows each recorded input down to a product nobody made — the end of the
 * chain — so a smartphone names its CPU and its glass, not the main module and
 * display unit those went into. A battery is noted wherever it occurs in the
 * chain: a passport links a phone's battery whether or not the factory made that
 * battery from something else first. An id seen once is not followed again.
 */
function rawInputs(state: Record<string, unknown>, lookup: ResourceLookup): { parts: string[]; batteries: string[] } {
  const parts: string[] = [];
  const batteries: string[] = [];
  const seen = new Set<string>();
  const visit = (id: string): void => {
    if (seen.has(id)) {
      return;
    }
    seen.add(id);
    const input = lookup(id);
    if (input?.meta?.types.includes(batteryClass)) {
      batteries.push(id);
    }
    const further = input ? inputsOf(input.state) : [];
    if (further.length === 0) {
      parts.push(id);
      return;
    }
    further.forEach(visit);
  };
  inputsOf(state).forEach(visit);
  return { parts, batteries };
}

/** Where another product resource's description is, relative to this one. */
function productLink(id: string): string {
  return `<${encodeURIComponent(id)}#product>`;
}

/**
 * Render one product resource.
 *
 * `iri` is where the resource is served, and every subject is a fragment of it, so
 * the document names nothing it does not also define. Another product is linked
 * by a relative IRI, which resolves beside this one under the same prefix.
 */
export function resourceToTurtle(
  id: string,
  state: Record<string, unknown>,
  meta?: ResourceMeta,
  traceIri?: string,
  lookup: ResourceLookup = () => undefined
): string {
  const nodes: Node[] = [];
  const statements = describe(state, meta?.properties ?? {}, [], nodes);

  const { parts, batteries } = rawInputs(state, lookup);
  statements.push(...batteries.map(battery => ({ predicate: 'ex:battery', object: productLink(battery) })));
  statements.push(...parts.map(part => ({ predicate: 'ex:input', object: productLink(part) })));

  if (traceIri !== undefined) {
    // How this product came to be: the records of the interactions that made it.
    statements.unshift({ predicate: 'ex:trace', object: `<${traceIri}>` });
  }
  statements.unshift({ predicate: 'schema:name', object: `"${escapeLiteral(id)}"` });

  const product: Node = {
    subject: '<#product>',
    classes: meta?.types.length ? meta.types : ['schema:Product'],
    statements
  };

  const document = [product, ...nodes].map(writeNode).join('\n\n');
  const used = Object.keys(namespaces).filter(prefix => new RegExp(`\\b${prefix}:`).test(document));
  const header = used
    .map(prefix => `@prefix ${`${prefix}:`.padEnd(8)}<${namespaces[prefix]}> .`)
    .join('\n');
  return `${header}\n\n${document}\n`;
}

function writeNode({ subject, classes, statements }: Node): string {
  const lines = [
    ...(classes.length ? [`    ${'a'.padEnd(22)} ${classes.join(', ')}`] : []),
    ...statements.map(({ predicate, object }) => `    ${predicate.padEnd(22)} ${object}`)
  ];
  return `${subject}\n${lines.join(' ;\n')} .`;
}

/** A product resource's live state and metadata, from the store recipes write to. */
const liveLookup: ResourceLookup = inputId => {
  const id = normalizeThingId(inputId);
  const states = globalState.things as Record<string, Record<string, unknown>>;
  // Serialised through JSON to detach the Valtio proxy the state is held in.
  return isResourceId(id) && states[id]
    ? { state: JSON.parse(JSON.stringify(states[id])) as Record<string, unknown>, meta: resourceMeta(id) }
    : undefined;
};

/** One product resource as it is now, or `undefined` when no product has that id. */
export function productTurtle(id: string, traceIri?: string): string | undefined {
  const product = liveLookup(id);
  return product && resourceToTurtle(normalizeThingId(id), product.state, product.meta, traceIri, liveLookup);
}

/**
 * The products a product's representation links: its battery and the raw inputs
 * it was made from, and what those link in turn — so a copy of the product and
 * these is a set of documents whose relative links all resolve among themselves.
 */
export function linkedProducts(id: string): string[] {
  const linked: string[] = [];
  const visit = (current: string): void => {
    const product = liveLookup(current);
    if (!product) {
      return;
    }
    const { parts, batteries } = rawInputs(product.state, liveLookup);
    for (const next of [...batteries, ...parts]) {
      if (next !== normalizeThingId(id) && !linked.includes(next)) {
        linked.push(next);
        visit(next);
      }
    }
  };
  visit(id);
  return linked;
}
