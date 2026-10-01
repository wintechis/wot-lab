/**
 * Which models the lab serves as plain web resources rather than as Things.
 *
 * A Thing is something you interact with: it offers affordances, and a Thing
 * Description tells a client what they are and how to reach them. A product on a
 * shopfloor offers none. Its Thing Description declares three Properties, all
 * `readOnly`, no Actions and no Events, and says in its own description that only
 * workstations and the transporter ever change them. That is not a device with a
 * read-only API — it is a workpiece, and what a client wants from it is its
 * current state.
 *
 * So a product is served as a resource with a representation. Nothing else about
 * it changes: its state still lives in `globalState`, which is what a station's
 * `vre:effects` writes through, so every recipe keeps working exactly as before —
 * `resolveThing` reads the state store, not the servient.
 *
 * The distinction is drawn from the model's own `@type`, not from a list of names
 * kept here. A model that calls itself a product is one.
 */

/** The class a model gives itself when it is a workpiece rather than a device. */
const resourceTypes = ['https://solid.ti.rw.fau.de/public/ns/arena#Product', 'arena:Product'];

/** The path segment every product resource is served under. */
export const resourcePrefix = 'products';

/**
 * Whether a Thing Description describes a resource rather than a Thing.
 *
 * `@type` is one term or several, and a compacted document writes the prefixed
 * form while an expanded one writes the full IRI — both are the same class, so
 * both count.
 */
export function isResourceModel(td: { '@type'?: unknown }): boolean {
  const types = td['@type'];
  const asArray = Array.isArray(types) ? types : [types];
  return asArray.some(type => typeof type === 'string' && resourceTypes.includes(type));
}

/** Where a product resource is served, given where the lab is served from. */
export function resourceIri(baseUrl: string, id: string): string {
  return `${baseUrl}/${resourcePrefix}/${encodeURIComponent(id)}`;
}

/**
 * Which ids name resources rather than Things.
 *
 * `globalState` keeps state by id and says nothing about what kind of entity an id
 * is. The registry knows as it creates and removes them, and both the HTTP surface
 * and the provenance sink need to ask — the one to serve a product, the other to
 * name it in a record. Kept here rather than in either of them, because what is a
 * resource is this module's question.
 */
const resources = new Map<string, ResourceMeta>();

/**
 * What a model said its resource and its Properties *are*.
 *
 * A Thing Description annotates itself and each Property with `@type`, and those
 * annotations are the only domain semantics the model carries — `arena:Product`,
 * `arena:XPosition`. Dropping a product's Thing Description must not drop them
 * too, or the resource would serve numbers with no indication of what they
 * measure. Kept per id because an instance is served, not a model.
 */
export interface ResourceMeta {
  /** The classes the model gives itself, e.g. `arena:Product`. */
  types: string[];
  /** What the model says about each Property, by Property name. */
  properties: Record<string, PropertyMeta>;
}

/**
 * What a model says about one Property, or about one member of an object
 * Property — a manufacturer's address is described the way the product is.
 */
export interface PropertyMeta {
  /** The class the Property is annotated with, e.g. `arena:XPosition`. */
  type?: string;
  /** The Property's `unit`, as a compact QUDT IRI such as `unit:MilliA-HR`. */
  unit?: string;
  /**
   * The predicate the model asks for with `lab:predicate`, e.g. `schema:mpn`,
   * where a product passport uses a term from a vocabulary of its own.
   */
  predicate?: string;
  /** The members of an object Property, by name. */
  properties?: Record<string, PropertyMeta>;
}

/**
 * The Property in which a product records what it was made from: the ids of the
 * recipe inputs a station consumed to produce it, written by the recipe's
 * `vre:effects`. Empty for a product nobody produced — a raw material, or one not
 * made yet.
 */
export const inputsProperty = 'madeFrom';

/** Note that an id names a resource, not a Thing, and what it says it is. */
export function registerResourceId(id: string, meta: ResourceMeta = { types: [], properties: {} }): void {
  resources.set(id, meta);
}

/** Forget a resource, as its Thing-shaped counterpart is forgotten. */
export function unregisterResourceId(id: string): void {
  resources.delete(id);
}

/** Whether this id names a resource the lab serves rather than a Thing. */
export function isResourceId(id: string): boolean {
  return resources.has(id);
}

/** Every resource id, in insertion order. */
export function resourceIdList(): string[] {
  return [...resources.keys()];
}

/** What this resource and its Properties say they are. */
export function resourceMeta(id: string): ResourceMeta | undefined {
  return resources.get(id);
}

/**
 * The annotations a Thing Description carries, as a resource's metadata.
 *
 * `@type` is one term or several in a Thing Description, and only the first is
 * kept for a Property: a Property is one kind of quantity, and a representation
 * that typed a value twice would be asserting something the model did not.
 */
export function metaFromThingDescription(td: Record<string, unknown>): ResourceMeta {
  return {
    types: asList(td['@type']),
    properties: propertiesMeta(td.properties)
  };
}

function asList(value: unknown): string[] {
  return (Array.isArray(value) ? value : [value]).filter((item): item is string => typeof item === 'string');
}

function propertiesMeta(properties: unknown): Record<string, PropertyMeta> {
  const schemas = (properties ?? {}) as Record<string, Record<string, unknown>>;
  return Object.fromEntries(Object.entries(schemas).map(([name, schema]) => {
    const meta: PropertyMeta = {};
    const type = asList(schema['@type'])[0];
    if (type !== undefined) {
      meta.type = type;
    }
    if (typeof schema.unit === 'string') {
      meta.unit = schema.unit;
    }
    if (typeof schema['lab:predicate'] === 'string') {
      meta.predicate = schema['lab:predicate'];
    }
    if (schema.type === 'object' && schema.properties) {
      meta.properties = propertiesMeta(schema.properties);
    }
    return [name, meta];
  }));
}
