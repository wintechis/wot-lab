/**
 * VRE parser — lexer, AST, and recursive-descent parser.
 *
 * Vendored from the V-Realm project's `implementation/vre-to-spa.ts` (the `lex`
 * function, the `VREExpr` AST, and the `Parser` expression grammar), adapted for
 * wot-lab:
 *   - dropped `const name = <uri>;` bindings and URI tokens (single-Thing loader
 *     has no cross-Thing references), so `<`/`>` lex as comparison operators;
 *   - added `{` / `}` tokens and an `on <action>(params) { ... }` rule grammar
 *     with a `guard` statement (V-Realm's effect DSL has neither — its action
 *     name is caller-supplied and guards live in its separate VRP layer);
 *   - added the equality/comparison precedence levels (V-Realm's lexer already
 *     tokenizes `== != < <= > >=` but its effect parser never consumes them).
 * Operator precedence below is preserved verbatim from V-Realm so expression
 * semantics match: `||` < `&&` < `== !=` < `< <= > >=` < `!` < `+ -` < `* / %`
 * < unary `-` < postfix `.method(...)` < primary.
 */

type TokenKind =
  | 'IDENT'
  | 'NUMBER'
  | 'BOOL'
  | 'PRIME'
  | 'ASSIGN'
  | 'EQ'
  | 'NEQ'
  | 'LT'
  | 'LTE'
  | 'GT'
  | 'GTE'
  | 'PLUS'
  | 'MINUS'
  | 'STAR'
  | 'SLASH'
  | 'PERCENT'
  | 'AND'
  | 'OR'
  | 'NOT'
  | 'LPAREN'
  | 'RPAREN'
  | 'LBRACKET'
  | 'RBRACKET'
  | 'LBRACE'
  | 'RBRACE'
  | 'DOT'
  | 'COMMA'
  | 'SEMICOLON'
  | 'EOF';

interface Token {
  kind: TokenKind;
  value: string;
  pos: number;
}

export type VREExpr =
  | { kind: 'number'; value: number }
  | { kind: 'bool'; value: boolean }
  | { kind: 'emptyArray' }
  | { kind: 'ref'; parts: string[] }
  | { kind: 'binary'; op: string; left: VREExpr; right: VREExpr }
  | { kind: 'unary'; op: string; operand: VREExpr }
  | { kind: 'call'; base: VREExpr; method: string; args: VREExpr[] };

export interface VreEffect {
  lhs: string[];
  rhs: VREExpr;
}
export interface VreRule {
  action: string;
  params: string[];
  guards: VREExpr[];
  effects: VreEffect[];
}

function lex(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    if (/\s/.test(input[i])) {
      i++;
      continue;
    }
    if (input[i] === '/' && input[i + 1] === '/') {
      while (i < input.length && input[i] !== '\n') {
        i++;
      }
      continue;
    }
    if (input[i] === '/' && input[i + 1] === '*') {
      i += 2;
      while (i < input.length && !(input[i] === '*' && input[i + 1] === '/')) {
        i++;
      }
      i += 2;
      continue;
    }
    const pos = i;
    if (input[i] === '<') {
      if (input[i + 1] === '=') {
        tokens.push({ kind: 'LTE', value: '<=', pos });
        i += 2;
      } else {
        tokens.push({ kind: 'LT', value: '<', pos });
        i++;
      }
      continue;
    }
    if (input[i] === '>') {
      if (input[i + 1] === '=') {
        tokens.push({ kind: 'GTE', value: '>=', pos });
        i += 2;
      } else {
        tokens.push({ kind: 'GT', value: '>', pos });
        i++;
      }
      continue;
    }
    if (/[0-9]/.test(input[i])) {
      let num = '';
      while (i < input.length && /[0-9.]/.test(input[i])) {
        num += input[i++];
      }
      tokens.push({ kind: 'NUMBER', value: num, pos });
      continue;
    }
    if (/[a-zA-Z_]/.test(input[i])) {
      let ident = '';
      while (i < input.length && /[a-zA-Z0-9_]/.test(input[i])) {
        ident += input[i++];
      }
      if (ident === 'true' || ident === 'false') {
        tokens.push({ kind: 'BOOL', value: ident, pos });
      } else {
        tokens.push({ kind: 'IDENT', value: ident, pos });
      }
      continue;
    }
    if (input[i] === '\'' || input[i] === '′') {
      tokens.push({ kind: 'PRIME', value: '\'', pos });
      i++;
      continue;
    }
    if (input[i] === '=' && input[i + 1] === '=') {
      tokens.push({ kind: 'EQ', value: '==', pos });
      i += 2;
      continue;
    }
    if (input[i] === '!' && input[i + 1] === '=') {
      tokens.push({ kind: 'NEQ', value: '!=', pos });
      i += 2;
      continue;
    }
    if (input[i] === '&' && input[i + 1] === '&') {
      tokens.push({ kind: 'AND', value: '&&', pos });
      i += 2;
      continue;
    }
    if (input[i] === '|' && input[i + 1] === '|') {
      tokens.push({ kind: 'OR', value: '||', pos });
      i += 2;
      continue;
    }
    const singles: Record<string, TokenKind> = {
      '=': 'ASSIGN',
      '+': 'PLUS',
      '-': 'MINUS',
      '*': 'STAR',
      '/': 'SLASH',
      '%': 'PERCENT',
      '!': 'NOT',
      '(': 'LPAREN',
      ')': 'RPAREN',
      '[': 'LBRACKET',
      ']': 'RBRACKET',
      '{': 'LBRACE',
      '}': 'RBRACE',
      '.': 'DOT',
      ',': 'COMMA',
      ';': 'SEMICOLON'
    };
    if (input[i] in singles) {
      tokens.push({ kind: singles[input[i]], value: input[i], pos });
      i++;
      continue;
    }
    throw new Error(`VRE: unexpected character '${input[i]}' at position ${pos}`);
  }
  tokens.push({ kind: 'EOF', value: '', pos: input.length });
  return tokens;
}

class Parser {
  private pos = 0;
  // eslint-disable-next-line no-unused-vars
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.pos];
  }
  private peekAt(offset: number): Token {
    const idx = this.pos + offset;
    return idx < this.tokens.length
      ? this.tokens[idx]
      : { kind: 'EOF', value: '', pos: -1 };
  }
  private consume(): Token {
    return this.tokens[this.pos++];
  }
  private expect(kind: TokenKind): Token {
    const t = this.consume();
    if (t.kind !== kind) {
      throw new Error(
        `VRE: expected ${kind}, got ${t.kind} ('${t.value}') at position ${t.pos}`
      );
    }
    return t;
  }
  private match(kind: TokenKind): boolean {
    if (this.peek().kind === kind) {
      this.consume();
      return true;
    }
    return false;
  }

  parseProgram(): VreRule[] {
    const rules: VreRule[] = [];
    while (this.peek().kind !== 'EOF') {
      rules.push(this.parseRule());
    }
    return rules;
  }

  private parseRule(): VreRule {
    const kw = this.expect('IDENT');
    if (kw.value !== 'on') {
      throw new Error(
        `VRE: expected 'on' to start an action rule, got '${kw.value}' at position ${kw.pos}`
      );
    }
    const action = this.expect('IDENT').value;
    this.expect('LPAREN');
    const params: string[] = [];
    if (this.peek().kind !== 'RPAREN') {
      params.push(this.expect('IDENT').value);
      while (this.match('COMMA')) {
        params.push(this.expect('IDENT').value);
      }
    }
    this.expect('RPAREN');
    this.expect('LBRACE');
    const guards: VREExpr[] = [];
    const effects: VreEffect[] = [];
    while (this.peek().kind !== 'RBRACE') {
      const t = this.peek();
      if (t.kind === 'IDENT' && t.value === 'guard') {
        this.consume();
        guards.push(this.parseExpr());
        this.match('SEMICOLON');
      } else {
        effects.push(this.parseEffectStmt());
      }
    }
    this.expect('RBRACE');
    return { action, params, guards, effects };
  }

  private parseEffectStmt(): VreEffect {
    const parts: string[] = [this.expect('IDENT').value];
    while (this.peek().kind === 'DOT' && this.peekAt(1).kind === 'IDENT') {
      this.consume();
      parts.push(this.consume().value);
    }
    this.expect('PRIME');
    this.expect('ASSIGN');
    const rhs = this.parseExpr();
    this.match('SEMICOLON');
    return { lhs: parts, rhs };
  }

  private parseExpr(): VREExpr {
    return this.parseOr();
  }
  private parseOr(): VREExpr {
    let left = this.parseAnd();
    while (this.peek().kind === 'OR') {
      this.consume();
      left = { kind: 'binary', op: '||', left, right: this.parseAnd() };
    }
    return left;
  }
  private parseAnd(): VREExpr {
    let left = this.parseEquality();
    while (this.peek().kind === 'AND') {
      this.consume();
      left = { kind: 'binary', op: '&&', left, right: this.parseEquality() };
    }
    return left;
  }
  private parseEquality(): VREExpr {
    let left = this.parseComparison();
    while (this.peek().kind === 'EQ' || this.peek().kind === 'NEQ') {
      const op = this.consume().value;
      left = { kind: 'binary', op, left, right: this.parseComparison() };
    }
    return left;
  }
  private parseComparison(): VREExpr {
    let left = this.parseNot();
    while (
      this.peek().kind === 'LT' ||
      this.peek().kind === 'LTE' ||
      this.peek().kind === 'GT' ||
      this.peek().kind === 'GTE'
    ) {
      const op = this.consume().value;
      left = { kind: 'binary', op, left, right: this.parseNot() };
    }
    return left;
  }
  private parseNot(): VREExpr {
    if (this.peek().kind === 'NOT') {
      this.consume();
      return { kind: 'unary', op: '!', operand: this.parseNot() };
    }
    return this.parseAdd();
  }
  private parseAdd(): VREExpr {
    let left = this.parseMul();
    while (this.peek().kind === 'PLUS' || this.peek().kind === 'MINUS') {
      const op = this.consume().value;
      left = { kind: 'binary', op, left, right: this.parseMul() };
    }
    return left;
  }
  private parseMul(): VREExpr {
    let left = this.parseUnary();
    while (
      this.peek().kind === 'STAR' ||
      this.peek().kind === 'SLASH' ||
      this.peek().kind === 'PERCENT'
    ) {
      const op = this.consume().value;
      left = { kind: 'binary', op, left, right: this.parseUnary() };
    }
    return left;
  }
  private parseUnary(): VREExpr {
    if (this.peek().kind === 'MINUS') {
      this.consume();
      return { kind: 'unary', op: '-', operand: this.parseUnary() };
    }
    return this.parsePostfix();
  }
  private parsePostfix(): VREExpr {
    let base = this.parsePrimary();
    while (
      this.peek().kind === 'DOT' &&
      this.peekAt(1).kind === 'IDENT' &&
      this.peekAt(2).kind === 'LPAREN'
    ) {
      this.consume();
      const method = this.expect('IDENT').value;
      this.expect('LPAREN');
      const args: VREExpr[] = [];
      if (this.peek().kind !== 'RPAREN') {
        args.push(this.parseExpr());
        while (this.match('COMMA')) {
          args.push(this.parseExpr());
        }
      }
      this.expect('RPAREN');
      base = { kind: 'call', base, method, args };
    }
    return base;
  }
  private parsePrimary(): VREExpr {
    const t = this.peek();
    if (t.kind === 'LPAREN') {
      this.consume();
      const expr = this.parseExpr();
      this.expect('RPAREN');
      return expr;
    }
    if (t.kind === 'NUMBER') {
      this.consume();
      return { kind: 'number', value: parseFloat(t.value) };
    }
    if (t.kind === 'BOOL') {
      this.consume();
      return { kind: 'bool', value: t.value === 'true' };
    }
    if (t.kind === 'LBRACKET') {
      this.consume();
      this.expect('RBRACKET');
      return { kind: 'emptyArray' };
    }
    if (t.kind === 'IDENT') {
      const parts: string[] = [this.consume().value];
      while (
        this.peek().kind === 'DOT' &&
        this.peekAt(1).kind === 'IDENT' &&
        this.peekAt(2).kind !== 'LPAREN'
      ) {
        this.consume();
        parts.push(this.consume().value);
      }
      return { kind: 'ref', parts };
    }
    throw new Error(
      `VRE: unexpected token ${t.kind} ('${t.value}') at position ${t.pos}`
    );
  }
}

/** Parse a `.vre` source string into action rules. */
export function parseVre(source: string): VreRule[] {
  return new Parser(lex(source)).parseProgram();
}
