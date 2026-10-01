/**
 * A product resource's representation: its current state as Turtle.
 *
 * Turtle by default because a product is data about a physical item, and the
 * things that read it are the same things that read the provenance records in the
 * pod — a JSON representation would have to be translated before it could be
 * joined against anything. JSON is still served to a client that asks for it.
 *
 * The shape follows the product passports under `phone resources/`: a lowercase
 * predicate carries each Property, and a Property the model gave a class to
 * becomes a node of that class rather than a bare number, the way a passport
 * writes `ex:ratedCapacity` pointing at a `qudt:QuantityValue`. The classes come
 * from the model's own `@type` annotations, so the semantics a Thing Description
 * carried survive the product no longer being a Thing.
 *
 * Only in type position. Every term the shopfloor vocabulary defines is
 * initial-capital — `arena:XPosition`, `arena:State` — which names a kind of
 * thing, not a way of relating two, so none of them is used as a predicate.
 * Predicates come from the passport namespace, named after the Property they
 * carry: mechanical rather than prettier, so a reader can predict the predicate
 * from the Thing Description and a new model needs no mapping added here.
 *
 * No `qudt:unit` is written, because no model declares one. A unit invented here
 * would be a measurement claim the lab has no basis for — a position on a
 * shopfloor grid is not metres unless someone says so.
 */

import { escapeLiteral, isAbsoluteHttpIri } from '../solid/stateResource.js';
import { ResourceMeta } from './resources.js';

/** The vocabularies a representation is written in, by prefix. */
const namespaces: Record<string, string> = {
  ex: 'https://example.org/passport/',
  schema: 'https://schema.org/',
  qudt: 'http://qudt.org/schema/qudt/',
  arena: 'https://solid.ti.rw.fau.de/public/ns/arena#',
  xsd: 'http://www.w3.org/2001/XMLSchema#'
};

/**
 * One state value as a Turtle literal, or `undefined` when RDF has no literal for
 * it — `null`, which a product carries whenever it has no position, and which at
 * predicate position is said by saying nothing.
 */
function literal(value: unknown): string | undefined {
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return undefined;
    }
    return Number.isSafeInteger(value) && !Object.is(value, -0) ? String(value) : `"${value}"^^xsd:double`;
  }
  if (typeof value === 'string') {
    return isAbsoluteHttpIri(value) ? `<${value}>` : `"${escapeLiteral(value)}"`;
  }
  return undefined;
}

/** A Property name as a predicate local name, safe to write after a prefix. */
function predicateFor(name: string): string | undefined {
  return /^[A-Za-z][A-Za-z0-9_-]*$/.test(name) ? `ex:${name}` : undefined;
}

interface Statement {
  predicate: string;
  object: string;
}

/**
 * Render one product resource.
 *
 * `iri` is where the resource is served, and every subject is a fragment of it, so
 * the document names nothing it does not also define.
 */
export function resourceToTurtle(
  id: string,
  state: Record<string, unknown>,
  meta?: ResourceMeta,
  traceIri?: string
): string {
  const statements: Statement[] = [];
  const qualified: string[] = [];

  for (const [name, value] of Object.entries(state)) {
    const predicate = predicateFor(name);
    const object = literal(value);
    if (predicate === undefined || object === undefined) {
      continue;
    }
    const propertyType = meta?.propertyTypes[name];
    // A Property the model classified, holding a number, becomes a quantity node:
    // the class says what the number is, which a bare literal cannot.
    if (propertyType !== undefined && typeof value === 'number') {
      statements.push({ predicate, object: `<#${name}>` });
      qualified.push([
        `<#${name}>`,
        `    a                  ${propertyType}, qudt:QuantityValue ;`,
        `    qudt:numericValue  ${object} .`
      ].join('\n'));
      continue;
    }
    statements.push({ predicate, object });
  }

  if (traceIri !== undefined) {
    // How this product came to be: the records of the interactions that made it.
    statements.unshift({ predicate: 'ex:trace', object: `<${traceIri}>` });
  }
  statements.unshift({ predicate: 'schema:name', object: `"${escapeLiteral(id)}"` });

  const classes = meta?.types.length ? meta.types.join(', ') : 'schema:Product';
  const body = [`    a                  ${classes}`, ...statements.map(
    ({ predicate, object }) => `    ${predicate.padEnd(18)} ${object}`
  )].join(' ;\n');

  const used = new Set<string>();
  const document = [`<#product>\n${body} .`, ...qualified].join('\n\n');
  for (const prefix of Object.keys(namespaces)) {
    if (new RegExp(`\\b${prefix}:`).test(document)) {
      used.add(prefix);
    }
  }

  const header = [...used]
    .map(prefix => `@prefix ${`${prefix}:`.padEnd(8)}<${namespaces[prefix]}> .`)
    .join('\n');
  return `${header}\n\n${document}\n`;
}
