// Tests for describe.ts.
import { describe, expect, it } from 'vitest';
import { describeArguments, describeValue, formatValue, nameOf } from './describe';

class TypstDocument {}

/** As the hosts make them: private state, public fields, a getter, methods. */
class DocumentEditor {
  readonly #views = { visual: 1 };
  viewType = 'visualEditor';
  readonly _internal = 1;

  constructor(readonly document: TypstDocument) {}

  get selection() {
    return { from: this.#views.visual, to: 3 };
  }

  get broken(): never {
    throw new Error('no view');
  }

  revealRange(): void {}
}

describe('formatValue', () => {
  it('pretty-prints objects several levels deep, short ones on one line', () => {
    const change = { kind: 'update', path: '/main.typ', content: '= Hello\n\nA paragraph with some words in it.' };
    expect(formatValue(change).text).toBe(['{', '  kind: "update",', '  path: "/main.typ",', '  content: "= Hello\\n\\nA paragraph with some words in it."', '}'].join('\n'));
    expect(formatValue({ from: 1, to: 2 }).text).toBe('{ from: 1, to: 2 }');
    expect(formatValue({ a: { b: { c: { d: { e: 1 } } } } }).text).toBe(['{', '  a: {', '    b: {', '      c: { d: {…} }', '    }', '  }', '}'].join('\n'));
  });

  it('shows class instances by their class, public fields and getters, without methods or private state', () => {
    const { text, line } = formatValue({ textEditor: new DocumentEditor(new TypstDocument()) });
    expect(text).toBe(['{', '  textEditor: DocumentEditor {', '    document: TypstDocument {},', '    viewType: "visualEditor",', '    selection: { from: 1, to: 3 }', '  }', '}'].join('\n'));
    expect(line).toBe('{ textEditor: DocumentEditor { document: TypstDocument {}, viewType: "visualEditor", selection: { from: 1, to: 3 } } }');
  });

  it('names elements, functions, bytes, maps and sets; marks cycles', () => {
    expect(formatValue({ nodeType: 1, nodeName: 'SVG' }).text).toBe('<svg>');
    expect(formatValue(function provide() {}).text).toBe('ƒ provide');
    expect(formatValue(new Uint8Array(12)).text).toBe('Uint8Array(12 bytes)');
    expect(formatValue(new Map([['a', 1]])).text).toBe('Map(1) { "a": 1 }');
    expect(formatValue(new Set([1, 2])).text).toBe('Set(2) [1, 2]');
    const cycle: Record<string, unknown> = { name: 'a' };
    cycle.self = cycle;
    expect(formatValue(cycle).text).toBe('{ name: "a", self: [circular] }');
  });

  it('cuts long text saying how long it was, long lists after some items, and the one line', () => {
    expect(formatValue('x'.repeat(3000)).text).toBe(`"${'x'.repeat(2000)}… (3000 characters)"`);
    expect(formatValue(Array.from({ length: 30 }, (_, index) => index)).text).toContain('… 5 more');
    expect(formatValue({ text: 'y'.repeat(500) }).line).toHaveLength(160);
  });
});

describe('describeValue', () => {
  it('is one line, one level deep, short strings', () => {
    expect(describeValue({ kind: 'update', path: '/main.typ', change: { from: 1 } })).toBe('{ kind: "update", path: "/main.typ", change: {…} }');
    expect(describeValue({ document: new TypstDocument() })).toBe('{ document: TypstDocument {…} }');
    expect(describeValue('a\nb')).toBe('"a\\nb"');
    expect(describeValue('x'.repeat(100))).toBe(`"${'x'.repeat(60)}… (100 characters)"`);
    expect(describeValue([1, 2, 3, 4, 5, 6])).toBe('[1, 2, 3, 4, …]');
  });
});

describe('describeArguments', () => {
  it("names a registration by its strings and its objects' names, leaving out providers and long text", () => {
    expect(describeArguments(['files.newFile', () => {}])).toBe('files.newFile');
    expect(describeArguments(['file/newFile', { command: 'files.newFile', title: 'New file…' }])).toBe('file/newFile · files.newFile');
    expect(describeArguments([() => null, { priority: 110 }])).toBe('priority 110');
    expect(describeArguments(['.a { color: red }\n.b {}'])).toBe('(23 characters)');
  });
});

describe('nameOf', () => {
  it('names functions and class instances, not anonymous ones or plain objects', () => {
    expect(nameOf(function images() {})).toBe('images');
    expect(nameOf(new TypstDocument())).toBe('TypstDocument');
    expect(nameOf(() => {})).toBeUndefined();
    expect(nameOf({})).toBeUndefined();
  });
});
