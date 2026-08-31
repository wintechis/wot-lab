import * as WoT from 'wot-typescript-definitions';
import { parseVre, VREExpr, VreRule } from './vre-parser.js';

/**
 * Compile a `.vre` file into JavaScript that registers WoT action handlers.
 *
 * Parsing (lexer + expression grammar + AST) is vendored from V-Realm's VRE — see
 * `vre-parser.ts`. This module is the wot-lab code generator: it walks the AST and
 * emits `thing.setActionHandler(...)` bodies (guards → throw, effects →
 * `state.X = ...` + `emitPropertyChange`). The emitted string is appended to a
 * Thing's logic body and evaluated in the same sandbox (`thing`, `state`, ...).
 *
 * Reference resolution is TD-informed (single-Thing): a bare identifier naming an
 * action input parameter resolves to that input value; a bare identifier naming a
 * Thing property resolves to `state[name]`; effect targets (LHS) must be Thing
 * properties. Dotted / cross-Thing references are not supported here.
 */

interface ActionInputSchema {
  type?: string;
  properties?: Record<string, unknown>;
}
interface ActionSchema {
  input?: ActionInputSchema;
}

interface Ctx {
  params: Set<string>;
  properties: Set<string>;
  action: string;
}

function genExpr(expr: VREExpr, ctx: Ctx): string {
  if (expr.kind === 'number') {
    return String(expr.value);
  }
  if (expr.kind === 'bool') {
    return expr.value ? 'true' : 'false';
  }
  if (expr.kind === 'emptyArray') {
    return '[]';
  }
  if (expr.kind === 'ref') {
    if (expr.parts.length > 1) {
      throw new Error(
        `VRE: cross-Thing reference '${expr.parts.join('.')}' is not supported in action '${ctx.action}'`
      );
    }
    const name = expr.parts[0];
    if (ctx.params.has(name)) {
      return `__p_${name}`;
    }
    if (ctx.properties.has(name)) {
      return `state[${JSON.stringify(name)}]`;
    }
    throw new Error(
      `VRE: '${name}' in action '${ctx.action}' is neither an input parameter nor a Thing property`
    );
  }
  if (expr.kind === 'unary') {
    return `(${expr.op}${genExpr(expr.operand, ctx)})`;
  }
  if (expr.kind === 'binary') {
    const op = expr.op === '==' ? '===' : expr.op === '!=' ? '!==' : expr.op;
    return `(${genExpr(expr.left, ctx)} ${op} ${genExpr(expr.right, ctx)})`;
  }
  // call: append / remove
  const base = genExpr(expr.base, ctx);
  if (expr.method === 'append') {
    if (expr.args.length !== 1) {
      throw new Error('VRE: append(x) takes exactly one argument');
    }
    return `[...(${base}), ${genExpr(expr.args[0], ctx)}]`;
  }
  if (expr.method === 'remove') {
    if (expr.args.length !== 1) {
      throw new Error('VRE: remove(x) takes exactly one argument');
    }
    return `(${base}).filter((__e) => __e !== ${genExpr(expr.args[0], ctx)})`;
  }
  throw new Error(
    `VRE: unsupported collection method '${expr.method}' (only append/remove)`
  );
}

function genRule(rule: VreRule, td: WoT.ThingDescription): string {
  const properties = new Set(Object.keys(td.properties ?? {}));
  const actions = (td.actions ?? {}) as unknown as Record<string, ActionSchema>;

  if (!actions[rule.action]) {
    throw new Error(
      `VRE: action '${rule.action}' is not declared in the Thing Description`
    );
  }

  const ctx: Ctx = {
    params: new Set(rule.params),
    properties,
    action: rule.action
  };

  const input = actions[rule.action].input;
  const isObjectInput = Boolean(
    input && input.type === 'object' && input.properties
  );
  if (!isObjectInput && rule.params.length > 1) {
    throw new Error(
      `VRE: action '${rule.action}' has a scalar input but the rule declares multiple parameters`
    );
  }

  let body = '  const __input = await inputData.value();\n';
  for (const p of rule.params) {
    const accessor = isObjectInput ? `__input[${JSON.stringify(p)}]` : '__input';
    body += `  const __p_${p} = ${accessor};\n`;
  }
  for (const g of rule.guards) {
    const message = `VRE precondition failed for action '${rule.action}'`;
    body += `  if (!(${genExpr(g, ctx)})) { throw new Error(${JSON.stringify(
      message
    )}); }\n`;
  }
  for (const effect of rule.effects) {
    if (effect.lhs.length > 1) {
      throw new Error(
        `VRE: cross-Thing effect target '${effect.lhs.join('.')}' is not supported in action '${rule.action}'`
      );
    }
    const target = effect.lhs[0];
    if (!properties.has(target)) {
      throw new Error(
        `VRE: effect target '${target}' in action '${rule.action}' is not a Thing property`
      );
    }
    body += `  state[${JSON.stringify(target)}] = ${genExpr(effect.rhs, ctx)};\n`;
    body += `  thing.emitPropertyChange(${JSON.stringify(target)});\n`;
  }

  return `thing.setActionHandler(${JSON.stringify(
    rule.action
  )}, async (inputData) => {\n${body}});\n`;
}

/** Compile `.vre` source into JS that registers the described action handlers. */
export function vreToHandlers(source: string, td: WoT.ThingDescription): string {
  return parseVre(source)
    .map((rule) => genRule(rule, td))
    .join('\n');
}
