type TokenKind =
  | 'CONST'
  | 'IDENT'
  | 'URI'
  | 'NUMBER'
  | 'BOOL'
  | 'NULL'
  | 'STRING'
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
  | 'DOT'
  | 'COMMA'
  | 'SEMICOLON'
  | 'QUESTION'
  | 'COLON'
  | 'EOF';

interface Token {
  kind: TokenKind;
  value: string;
  pos: number;
}

export type VREExpr =
  | { kind: 'number'; value: number }
  | { kind: 'bool'; value: boolean }
  // `null` is the unset value: a Property that has no value yet (a setpoint
  // nobody has chosen) rather than a wrong one. Comparable with == / != only.
  | { kind: 'null' }
  | { kind: 'string'; value: string }
  | { kind: 'emptyArray' }
  // `post` marks a primed reference (`count'`) in an expression: it denotes the
  // POST-state value. An unprimed reference denotes the PRE-state value. This is
  // the one convention shared by VRE effects, VRE outputs and VRP permissions.
  | { kind: 'ref'; parts: string[]; post?: boolean }
  | { kind: 'binary'; op: string; left: VREExpr; right: VREExpr }
  | { kind: 'unary'; op: string; operand: VREExpr }
  | {
      kind: 'conditional';
      condition: VREExpr;
      whenTrue: VREExpr;
      whenFalse: VREExpr;
    }
  | { kind: 'functionCall'; name: string; args: VREExpr[] }
  | { kind: 'call'; base: VREExpr; method: string; args: VREExpr[] };

export interface VreEffect {
  lhs: string[];
  rhs: VREExpr;
}
export interface VreEvent {
  name: string;
  data?: VREExpr;
}
/** An `output.<path> = <expr>` assignment: a field of the action's return value. */
export interface VreOutput {
  path: string[];
  value: VREExpr;
}
export interface VreProgram {
  bindings: Map<string, string>;
  effects: VreEffect[];
  events: VreEvent[];
  outputs: VreOutput[];
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
        i++;
        let uri = '';
        while (i < input.length && input[i] !== '>') {
          uri += input[i++];
        }
        if (i >= input.length) {
          throw new Error(`VRE: unterminated URI at position ${pos}`);
        }
        i++;
        tokens.push({ kind: 'URI', value: uri, pos });
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
      if (ident === 'const') {
        tokens.push({ kind: 'CONST', value: ident, pos });
      } else if (ident === 'true' || ident === 'false') {
        tokens.push({ kind: 'BOOL', value: ident, pos });
      } else if (ident === 'null') {
        tokens.push({ kind: 'NULL', value: ident, pos });
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
    if (input[i] === '"') {
      i++;
      let value = '';
      while (i < input.length && input[i] !== '"') {
        if (input[i] === '\\' && i + 1 < input.length) {
          value += input[i++];
        }
        value += input[i++];
      }
      if (i >= input.length) {
        throw new Error(`VRE: unterminated string at position ${pos}`);
      }
      i++;
      tokens.push({ kind: 'STRING', value, pos });
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
      '.': 'DOT',
      ',': 'COMMA',
      ';': 'SEMICOLON',
      '?': 'QUESTION',
      ':': 'COLON'
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

  parseProgram(): VreProgram {
    const bindings = new Map<string, string>();
    const effects: VreEffect[] = [];
    const events: VreEvent[] = [];
    const outputs: VreOutput[] = [];
    while (this.peek().kind === 'CONST') {
      this.consume();
      const name = this.expect('IDENT').value;
      this.expect('ASSIGN');
      const uri = this.expect('URI').value;
      this.match('SEMICOLON');
      bindings.set(name, uri);
    }
    while (this.peek().kind !== 'EOF') {
      if (this.peek().kind === 'IDENT' && this.peek().value === 'emitEvent') {
        events.push(this.parseEventStmt());
      } else if (
        this.peek().kind === 'IDENT' &&
        this.peek().value === 'output' &&
        this.peekAt(1).kind === 'DOT'
      ) {
        outputs.push(this.parseOutputStmt());
      } else {
        effects.push(this.parseEffectStmt());
      }
    }
    return { bindings, effects, events, outputs };
  }

  // `output.a.b = expr` — a field (possibly nested) of the action's return
  // value. Distinguished from an effect by the `output` head and the absence of
  // a prime before `=` (effect targets are primed).
  private parseOutputStmt(): VreOutput {
    this.expect('IDENT'); // `output`
    const path: string[] = [];
    while (this.peek().kind === 'DOT' && this.peekAt(1).kind === 'IDENT') {
      this.consume();
      path.push(this.consume().value);
    }
    if (path.length === 0) {
      throw new Error('VRE: output must name a field, e.g. output.amount = ...');
    }
    this.expect('ASSIGN');
    const value = this.parseExpr();
    this.match('SEMICOLON');
    return { path, value };
  }

  private parseEventStmt(): VreEvent {
    this.expect('IDENT');
    this.expect('LPAREN');
    const name = this.expect('STRING').value;
    let data: VREExpr | undefined;
    if (this.match('COMMA')) {
      data = this.parseExpr();
    }
    this.expect('RPAREN');
    this.match('SEMICOLON');
    return { name: JSON.parse(`"${name}"`) as string, data };
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
    return this.parseConditional();
  }
  private parseConditional(): VREExpr {
    const condition = this.parseOr();
    if (!this.match('QUESTION')) {
      return condition;
    }
    const whenTrue = this.parseExpr();
    this.expect('COLON');
    const whenFalse = this.parseExpr();
    return { kind: 'conditional', condition, whenTrue, whenFalse };
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
    if (t.kind === 'NULL') {
      this.consume();
      return { kind: 'null' };
    }
    if (t.kind === 'STRING') {
      this.consume();
      return { kind: 'string', value: JSON.parse(`"${t.value}"`) as string };
    }
    if (t.kind === 'LBRACKET') {
      this.consume();
      this.expect('RBRACKET');
      return { kind: 'emptyArray' };
    }
    if (t.kind === 'IDENT') {
      const name = this.consume().value;
      if (this.match('LPAREN')) {
        const args: VREExpr[] = [];
        if (this.peek().kind !== 'RPAREN') {
          args.push(this.parseExpr());
          while (this.match('COMMA')) {
            args.push(this.parseExpr());
          }
        }
        this.expect('RPAREN');
        return { kind: 'functionCall', name, args };
      }
      const parts: string[] = [name];
      while (
        this.peek().kind === 'DOT' &&
        this.peekAt(1).kind === 'IDENT' &&
        this.peekAt(2).kind !== 'LPAREN'
      ) {
        this.consume();
        parts.push(this.consume().value);
      }
      // A trailing prime marks a POST-state reference (`balance'`) in an
      // expression. Effect targets consume their prime in parseEffectStmt, so a
      // prime here only ever belongs to a reference used as a value.
      const post = this.match('PRIME');
      return { kind: 'ref', parts, post };
    }
    throw new Error(
      `VRE: unexpected token ${t.kind} ('${t.value}') at position ${t.pos}`
    );
  }
}

/** Parse a VRE effect program: bindings followed by primed assignments. */
export function parseVre(source: string): VreProgram {
  return new Parser(lex(source)).parseProgram();
}
