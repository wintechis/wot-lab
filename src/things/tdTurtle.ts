/**
 * A Thing Description as Turtle.
 *
 * A TD is JSON-LD, so the Turtle is the same graph written differently: the TD
 * is parsed with its own `@context` and the quads are handed to N3. The contexts
 * are the W3C's and are fetched on first use; a TD's serialisation is cached
 * afterwards, since a TD does not change while the lab runs.
 */

import { JsonLdParser } from 'jsonld-streaming-parser';
import { Quad, Writer } from 'n3';

const prefixes: Record<string, string> = {
  td: 'https://www.w3.org/2019/wot/td#',
  jsonschema: 'https://www.w3.org/2019/wot/json-schema#',
  wotsec: 'https://www.w3.org/2019/wot/security#',
  hctl: 'https://www.w3.org/2019/wot/hypermedia#',
  htv: 'http://www.w3.org/2011/http#',
  arena: 'https://solid.ti.rw.fau.de/public/ns/arena#',
  qudt: 'http://qudt.org/schema/qudt#',
  xsd: 'http://www.w3.org/2001/XMLSchema#'
};

const cache = new Map<string, Promise<string>>();

/** Serialise a TD as Turtle, relative to `baseIri` for anything the TD leaves relative. */
export function thingDescriptionTurtle(key: string, td: unknown, baseIri: string): Promise<string> {
  let turtle = cache.get(key);
  if (!turtle) {
    turtle = convert(td, baseIri);
    cache.set(key, turtle);
    // A failure (a context that could not be fetched) must not be remembered.
    turtle.catch(() => cache.delete(key));
  }
  return turtle;
}

function convert(td: unknown, baseIri: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const writer = new Writer({ prefixes });
    const parser = new JsonLdParser({ baseIRI: baseIri });
    parser.on('data', (quad: Quad) => writer.addQuad(quad));
    parser.on('error', reject);
    parser.on('end', () => writer.end((error, result) => (error ? reject(error) : resolve(result))));
    parser.write(JSON.stringify(td));
    parser.end();
  });
}
