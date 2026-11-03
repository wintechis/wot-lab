import * as WoT from 'wot-typescript-definitions';

/**
 * Thing Models and the Thing Descriptions instantiated from them.
 *
 * A Thing is authored as a W3C WoT Thing Model (TD 1.1, section "Thing Model"):
 * `<name>.tm.json`, typed `tm:ThingModel`, with everything instance-specific
 * (`id`, `forms`, `security`, `base`) left out. The lab fills those in when it
 * brings an instance online, and what it serves is a Thing Description, which
 * must not be typed as a Thing Model.
 */

/** The file a Thing Model is stored in, inside its own directory. */
export function thingModelFileName(name: string): string {
  return `${name}.tm.json`;
}

export const TD_V1_CONTEXT = 'https://www.w3.org/2019/wot/td/v1';
export const TD_V11_CONTEXT = 'https://www.w3.org/2022/wot/td/v1.1';
export const THING_MODEL_TYPE = 'tm:ThingModel';

function typesOf(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string');
  }
  return typeof value === 'string' ? [value] : [];
}

/**
 * Mark a document as a Thing Model: `tm:ThingModel` in its `@type`, and the
 * TD 1.1 context (which is what defines the `tm:` prefix) in its `@context`.
 * Used when the lab writes a model someone authored in the dashboard.
 */
export function asThingModel(td: Record<string, unknown>): Record<string, unknown> {
  const types = typesOf(td['@type']);
  const context = td['@context'];
  const contexts = Array.isArray(context) ? [...context] : context === undefined ? [] : [context];
  if (!contexts.includes(TD_V11_CONTEXT)) {
    // TD 1.1: when the 1.0 context is kept for compatibility, 1.1 comes second.
    contexts.splice(contexts[0] === TD_V1_CONTEXT ? 1 : 0, 0, TD_V11_CONTEXT);
  }
  return {
    ...td,
    '@context': contexts.length === 1 ? contexts[0] : contexts,
    '@type': types.includes(THING_MODEL_TYPE) ? td['@type'] : [...types, THING_MODEL_TYPE]
  };
}

// TM-only terms a served Thing Description must not carry. `tm:optional` is
// dropped (every affordance is provided); `tm:ref` and `tm:extends` would need
// model composition, which the lab does not do, so a model using them is
// refused rather than served half-resolved.
const unsupportedThingModelTerms = /"tm:ref"|"tm:extends"|\{\{\s*[A-Za-z_][\w.-]*\s*\}\}/;

/**
 * Instantiate a Thing Model as the Thing Description of one instance.
 *
 * Removes `tm:ThingModel` from `@type` (restoring the author's own `@type`
 * exactly, or dropping the key when that was the only type) and the TM-only
 * `tm:optional` / `tm:required` keys. The caller adds `id`, title, links; node-wot
 * adds `forms` and `security` when it exposes the Thing.
 */
export function thingModelToThingDescription(
  model: Record<string, unknown>,
  modelName: string
): WoT.ThingDescription {
  const serialized = JSON.stringify(model);
  const unsupported = serialized.match(unsupportedThingModelTerms);
  if (unsupported) {
    throw new Error(
      `Thing Model '${modelName}' uses ${unsupported[0]}, which the lab does not resolve; write the model out in full`
    );
  }

  const types = typesOf(model['@type']).filter((entry) => entry !== THING_MODEL_TYPE);
  const td: Record<string, unknown> = {};
  // Rebuilt key by key so the served document keeps the model's key order.
  for (const [key, value] of Object.entries(model)) {
    if (key === 'tm:optional' || key === 'tm:required') {
      continue;
    }
    if (key === '@type') {
      if (types.length) {
        td[key] = types.length === 1 ? types[0] : types;
      }
      continue;
    }
    td[key] = value;
  }
  return td as WoT.ThingDescription;
}
