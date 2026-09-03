// Primer ships GitHub's syntax palette as Primitives tokens
// (--color-prettylights-syntax-*, themed for light and dark_dimmed alike) but no
// highlighter component, so tokenize here rather than take a dependency — JSON
// is a small enough grammar to be worth about fifteen lines.
//
// The kinds mirror the scopes GitHub's own `source.json` grammar assigns, so the
// output matches a GitHub blob: a key is `entity.name.tag.key.json` (.pl-ent),
// a string value `string.quoted.double.json` (.pl-s), and numbers plus
// true/false/null are `constant.*` (.pl-c1). Structural punctuation is
// deliberately left unstyled — GitHub's theme maps no class for it either.
// Escape sequences inside a string stay part of the string: they are scoped
// `constant.character.escape`, but .pl-cce is only ever styled nested inside a
// regexp, so in JSON they inherit the string colour.
type JsonToken = { text: string; kind: 'key' | 'string' | 'constant' | 'plain' };

// One alternation, ordered so a quoted string followed by ':' is claimed as a
// key before the plain-string branch can match it.
const jsonGrammar = /("(?:\\.|[^"\\])*")(?=\s*:)|("(?:\\.|[^"\\])*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(?:true|false|null)\b/g;

export function tokenizeJson(source: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  let cursor = 0;
  for (let match = jsonGrammar.exec(source); match; match = jsonGrammar.exec(source)) {
    if (match.index > cursor) tokens.push({ text: source.slice(cursor, match.index), kind: 'plain' });
    tokens.push({ text: match[0], kind: match[1] ? 'key' : match[2] ? 'string' : 'constant' });
    cursor = match.index + match[0].length;
  }
  jsonGrammar.lastIndex = 0;
  if (cursor < source.length) tokens.push({ text: source.slice(cursor), kind: 'plain' });
  return tokens;
}

export function HighlightedJson({ source }: { source: string }) {
  return <code>{tokenizeJson(source).map((token, index) =>
    token.kind === 'plain'
      ? token.text
      : <span key={index} className={`tok-${token.kind}`}>{token.text}</span>
  )}</code>;
}

// Any JSON the UI shows — a TD, an action result, an event payload, a worked
// example — goes through the same highlighter, so JSON looks like JSON wherever
// it appears rather than only in the source tab.
export function JsonBlock({ source, className }: { source: string; className: string }) {
  return <pre className={className}><HighlightedJson source={source} /></pre>;
}

// A filename-headed code panel, tokened to match the action/event result panels.
export function CodeExample({ filename, code }: { filename: string; code: string }) {
  return <div className="code-example">
    <div className="code-example-head"><span className="mono code-example-name">{filename}</span></div>
    <JsonBlock className="code-example-body" source={code} />
  </div>;
}
