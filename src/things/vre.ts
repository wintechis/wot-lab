import * as WoT from 'wot-typescript-definitions';
import { parseVre, VREExpr, VreProgram, VreOutput } from './vre-parser.js';

/**
 * Compile the `vre:effects` annotations in a Thing Description into JavaScript
 * that registers WoT action handlers.
 *
 * Parsing (lexer + expression grammar + AST) follows V-Realm's VRE effect
 * language — see `vre-parser.ts`. Effects are annotations on an action
 * affordance, so the action a program belongs to is the affordance carrying it;
 * VRE itself declares no actions.
 *
 * Reference resolution is TD-informed. A bare identifier naming an action input
 * parameter resolves to that input value; a bare identifier naming a Thing
 * property resolves to that property. A dotted identifier `handle.prop` names a
 * property on ANOTHER Thing, where `handle` is a static binding
 * (`const bank = <uri>`), an action input parameter carrying a Thing reference,
 * or a Thing property whose value is a Thing reference (so a shared annotation
 * can target a per-instance device set in the manifest). `this.id` is the
 * running instance's own id. A reference Property may also be empty (`false`,
 * `null`, `""`) — a transporter that carries nothing — in which case the handle
 * resolves to no Thing: reads give `undefined` and writes are discarded. Only a
 * non-empty reference that names no Thing is an error.
 *
 * Semantics follow V-Realm's flat effects: every effect's right-hand side is
 * evaluated against the PRE-state snapshot, then all effects are applied at
 * once (snapshot-then-apply). This holds across Things too. In expressions an
 * unprimed reference is the pre-state value and a primed reference (`x'`) is the
 * post-state value; primes are not allowed on the right-hand side of an effect.
 * Outputs and events are evaluated after effects apply.
 */

interface ActionInputSchema {
  type?: string;
  title?: string;
  properties?: Record<string, unknown>;
}
interface ActionSchema {
  input?: ActionInputSchema;
  'vre:effects'?: string;
}

type HandleKind = 'binding' | 'param' | 'property';

interface Ctx {
  params: Set<string>;
  properties: Set<string>;
  action: string;
  bindings: Map<string, string>;
}

const j = (value: string): string => JSON.stringify(value);

function genExpr(expr: VREExpr, ctx: Ctx): string {
  if (expr.kind === 'number') {
    return String(expr.value);
  }
  if (expr.kind === 'bool') {
    return expr.value ? 'true' : 'false';
  }
  if (expr.kind === 'null') {
    return 'null';
  }
  if (expr.kind === 'string') {
    return JSON.stringify(expr.value);
  }
  if (expr.kind === 'emptyArray') {
    return '[]';
  }
  if (expr.kind === 'ref') {
    return genRef(expr, ctx);
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
    // VRE has no functions. An effect reads state and its input, nothing else —
    // which is what makes a run reproducible from its initial state alone.
    // Behaviour that needs more belongs in logic.js.
    throw new Error(`VRE: unsupported function '${expr.name}'`);
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

function genRef(expr: Extract<VREExpr, { kind: 'ref' }>, ctx: Ctx): string {
  const parts = expr.parts;
  if (parts[0] === 'this') {
    if (parts.length === 2 && parts[1] === 'id') {
      return '__thingId';
    }
    throw new Error(
      `VRE: only 'this.id' is supported, got '${parts.join('.')}' in action '${ctx.action}'`
    );
  }
  if (parts.length === 1) {
    const name = parts[0];
    // A scalar input parameter is immutable across the handler, so pre/post do
    // not apply — it is always the value that came in.
    if (ctx.params.has(name)) {
      return `__p_${name}`;
    }
    if (ctx.properties.has(name)) {
      return expr.post ? `state[${j(name)}]` : `__pre[${j(name)}]`;
    }
    throw new Error(
      `VRE: '${name}' in action '${ctx.action}' is not a local property or input parameter`
    );
  }
  const head = parts[0];
  const prop = parts[parts.length - 1];
  if (ctx.bindings.has(head) || ctx.params.has(head) || ctx.properties.has(head)) {
    return expr.post
      ? `__t_${head}.state[${j(prop)}]`
      : `__pre_${head}[${j(prop)}]`;
  }
  throw new Error(
    `VRE: '${parts.join('.')}' in action '${ctx.action}' names no Thing binding, input parameter or property '${head}'`
  );
}

/** Reject a primed (post-state) reference on the right-hand side of an effect. */
function assertNoPost(expr: VREExpr, action: string): void {
  switch (expr.kind) {
  case 'ref':
    if (expr.post) {
      throw new Error(
        `VRE: a primed (post-state) reference is not allowed in an effect right-hand side, in action '${action}'`
      );
    }
    return;
  case 'unary':
    assertNoPost(expr.operand, action);
    return;
  case 'binary':
    assertNoPost(expr.left, action);
    assertNoPost(expr.right, action);
    return;
  case 'conditional':
    assertNoPost(expr.condition, action);
    assertNoPost(expr.whenTrue, action);
    assertNoPost(expr.whenFalse, action);
    return;
  case 'functionCall':
    expr.args.forEach((arg) => assertNoPost(arg, action));
    return;
  case 'call':
    assertNoPost(expr.base, action);
    expr.args.forEach((arg) => assertNoPost(arg, action));
    return;
  default:
    return;
  }
}

/** Collect the cross-Thing handles a program references, in first-seen order. */
function collectHandles(
  program: VreProgram,
  ctx: Ctx
): Map<string, HandleKind> {
  const handles = new Map<string, HandleKind>();

  const register = (head: string): void => {
    if (head === 'this' || handles.has(head)) {
      return;
    }
    if (ctx.bindings.has(head)) {
      handles.set(head, 'binding');
    } else if (ctx.params.has(head)) {
      handles.set(head, 'param');
    } else if (ctx.properties.has(head)) {
      // A property whose value is a Thing reference — dereferenced at runtime.
      handles.set(head, 'property');
    } else {
      throw new Error(
        `VRE: '${head}' in action '${ctx.action}' names no Thing binding, input parameter or property`
      );
    }
  };

  const walk = (expr: VREExpr): void => {
    switch (expr.kind) {
    case 'ref':
      if (expr.parts.length > 1 && expr.parts[0] !== 'this') {
        register(expr.parts[0]);
      }
      return;
    case 'unary':
      walk(expr.operand);
      return;
    case 'binary':
      walk(expr.left);
      walk(expr.right);
      return;
    case 'conditional':
      walk(expr.condition);
      walk(expr.whenTrue);
      walk(expr.whenFalse);
      return;
    case 'functionCall':
      expr.args.forEach(walk);
      return;
    case 'call':
      walk(expr.base);
      expr.args.forEach(walk);
      return;
    default:
      return;
    }
  };

  for (const effect of program.effects) {
    if (effect.lhs.length > 1) {
      register(effect.lhs[0]);
    }
    walk(effect.rhs);
  }
  for (const event of program.events) {
    if (event.data) {
      walk(event.data);
    }
  }
  for (const output of program.outputs) {
    walk(output.value);
  }
  return handles;
}

/** Build the nested-object assignment for one `output.<path> = <value>`. */
function genOutputAssign(output: VreOutput, ctx: Ctx): string {
  const { path } = output;
  let code = '';
  let accessor = '__out';
  for (let i = 0; i < path.length - 1; i++) {
    accessor += `[${j(path[i])}]`;
    code += `  ${accessor} = ${accessor} || {};\n`;
  }
  const full = '__out' + path.map((segment) => `[${j(segment)}]`).join('');
  code += `  ${full} = ${genExpr(output.value, ctx)};\n`;
  return code;
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

  program.effects.forEach((effect) => assertNoPost(effect.rhs, action));
  const handles = collectHandles(program, ctx);

  let body = '  const __input = await inputData.value();\n';
  const input = actions[action].input;
  const isObjectInput = Boolean(input?.type === 'object' && input.properties);
  for (const param of params) {
    const accessor = isObjectInput ? `__input[${j(param)}]` : '__input';
    body += `  const __p_${param} = ${accessor};\n`;
  }

  // Snapshot the local pre-state first, so a property-valued handle can read the
  // Thing reference it holds from the snapshot.
  body += '  const __pre = { ...state };\n';

  // Resolve every referenced Thing once and snapshot its pre-state. A static
  // binding resolves from its URI; a parameter handle from the input value that
  // carries the reference; a property handle from the property's pre-state value.
  for (const [handle, kind] of handles) {
    const source =
      kind === 'binding' ? j(ctx.bindings.get(handle) as string)
        : kind === 'param' ? `__p_${handle}`
          : `__pre[${j(handle)}]`;
    body += `  const __t_${handle} = resolveRef(${source});\n`;
    body += `  const __pre_${handle} = { ...__t_${handle}.state };\n`;
  }

  // Compute every effect value against the pre-state, THEN apply all of them.
  program.effects.forEach((effect, index) => {
    body += `  const __e${index} = ${genExpr(effect.rhs, ctx)};\n`;
  });
  program.effects.forEach((effect, index) => {
    const prop = effect.lhs[effect.lhs.length - 1];
    if (effect.lhs.length > 1) {
      const handle = effect.lhs[0];
      body += `  __t_${handle}.state[${j(prop)}] = __e${index};\n`;
      body += `  __t_${handle}.emit(${j(prop)});\n`;
    } else {
      if (!properties.has(prop)) {
        throw new Error(`VRE: effect target '${prop}' is not a Thing property`);
      }
      body += `  state[${j(prop)}] = __e${index};\n`;
      body += `  thing.emitPropertyChange(${j(prop)});\n`;
    }
  });

  for (const event of program.events) {
    const data = event.data ? `, ${genExpr(event.data, ctx)}` : '';
    body += `  thing.emitEvent(${j(event.name)}${data});\n`;
  }

  if (program.outputs.length > 0) {
    body += '  const __out = {};\n';
    for (const output of program.outputs) {
      body += genOutputAssign(output, ctx);
    }
    body += '  return __out;\n';
  }

  return `thing.setActionHandler(${j(action)}, async (inputData) => {\n${body}});\n`;
}

/**
 * The names a scalar (non-object) action input answers to.
 *
 * `input` always works. A scalar schema that gives itself a `title` — the way a
 * Thing Description names its single parameter, `"title": "level"` — is also
 * readable under that name, so an effect can say what the value means instead
 * of `input`. Both bind the same incoming value; nothing about the wire format
 * changes, the body is still the bare scalar.
 */
function scalarParams(input: ActionInputSchema): string[] {
  const title = input.title;
  return title && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(title) && title !== 'input'
    ? ['input', title]
    : ['input'];
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
        : input ? scalarParams(input) : [];
      return genRule(action, params, parseVre(effects as string), td);
    })
    .join('\n');
}
