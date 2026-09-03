import * as WoT from 'wot-typescript-definitions';
import { parseVre, VREExpr, VreProgram, VreEffect } from './vre-parser.js';

/**
 * Compile the `vre:effects` annotations in a Thing Description into JavaScript
 * that registers WoT action handlers.
 *
 * Parsing (lexer + expression grammar + AST) follows V-Realm's VRE effect
 * language — see `vre-parser.ts`. Effects are annotations on an action
 * affordance, so the action a program belongs to is the affordance carrying it;
 * VRE itself declares no actions.
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
  'vre:effects'?: string;
}

interface Ctx {
  params: Set<string>;
  properties: Set<string>;
  action: string;
  bindings: Map<string, string>;
}

function genExpr(expr: VREExpr, ctx: Ctx): string {
  if (expr.kind === 'number') {
    return String(expr.value);
  }
  if (expr.kind === 'bool') {
    return expr.value ? 'true' : 'false';
  }
  if (expr.kind === 'string') {
    return JSON.stringify(expr.value);
  }
  if (expr.kind === 'emptyArray') {
    return '[]';
  }
  if (expr.kind === 'ref') {
    if (expr.parts.length === 1 && ctx.params.has(expr.parts[0])) {
      return `__p_${expr.parts[0]}`;
    }
    const property = expr.parts.length === 1
      ? expr.parts[0]
      : expr.parts[expr.parts.length - 1];
    if (ctx.properties.has(property)) {
      if (expr.parts.length === 1 || ctx.bindings.has(expr.parts[0])) {
        return `state[${JSON.stringify(property)}]`;
      }
    }
    throw new Error(
      `VRE: '${expr.parts.join('.')}' in action '${ctx.action}' is not a local property or input parameter`
    );
  }
  if (expr.kind === 'unary') {
    return `(${expr.op}${genExpr(expr.operand, ctx)})`;
  }
  if (expr.kind === 'conditional') {
    return `(${genExpr(expr.condition, ctx)} ? ${genExpr(
      expr.whenTrue,
      ctx
    )} : ${genExpr(expr.whenFalse, ctx)})`;
  }
  if (expr.kind === 'functionCall') {
    if (expr.name !== 'now' || expr.args.length !== 0) {
      throw new Error(`VRE: unsupported function '${expr.name}'`);
    }
    return 'new Date().toISOString()';
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

function genEffect(effect: VreEffect, td: WoT.ThingDescription, ctx: Ctx): string {
  const properties = new Set(Object.keys(td.properties ?? {}));
  const target = effect.lhs[effect.lhs.length - 1];
  if (!properties.has(target)) {
    throw new Error(`VRE: effect target '${effect.lhs.join('.')}' is not a Thing property`);
  }
  if (effect.lhs.length > 1 && !ctx.bindings.has(effect.lhs[0])) {
    throw new Error(`VRE: unknown Thing binding '${effect.lhs[0]}' in effect target`);
  }
  return `  state[${JSON.stringify(target)}] = ${genExpr(effect.rhs, ctx)};\n` +
    `  thing.emitPropertyChange(${JSON.stringify(target)});\n`;
}

function genRule(
  action: string,
  params: string[],
  program: VreProgram,
  td: WoT.ThingDescription
): string {
  const properties = new Set(Object.keys(td.properties ?? {}));
  const actions = (td.actions ?? {}) as unknown as Record<string, ActionSchema>;
  if (!actions[action]) {
    throw new Error(`VRE: action '${action}' is not declared in the Thing Description`);
  }
  const ctx: Ctx = { params: new Set(params), properties, action, bindings: program.bindings };
  let body = '  const __input = await inputData.value();\n';
  const input = actions[action].input;
  const isObjectInput = Boolean(input?.type === 'object' && input.properties);
  for (const param of params) {
    const accessor = isObjectInput ? `__input[${JSON.stringify(param)}]` : '__input';
    body += `  const __p_${param} = ${accessor};\n`;
  }
  for (const effect of program.effects) {
    body += genEffect(effect, td, ctx);
  }
  for (const event of program.events) {
    const data = event.data ? `, ${genExpr(event.data, ctx)}` : '';
    body += `  thing.emitEvent(${JSON.stringify(event.name)}${data});\n`;
  }
  return `thing.setActionHandler(${JSON.stringify(
    action
  )}, async (inputData) => {\n${body}});\n`;
}

/** Compile the `vre:effects` annotations carried by a TD's action affordances. */
export function vreEffectsToHandlers(td: WoT.ThingDescription): string {
  const actions = (td.actions ?? {}) as unknown as Record<string, ActionSchema>;
  return Object.entries(actions)
    .filter(([, action]) => typeof action['vre:effects'] === 'string')
    .map(([action, definition]) => {
      const effects = definition['vre:effects'];
      const input = definition.input;
      const params = input?.type === 'object' && input.properties
        ? Object.keys(input.properties)
        : input ? ['input'] : [];
      return genRule(action, params, parseVre(effects as string), td);
    })
    .join('\n');
}
