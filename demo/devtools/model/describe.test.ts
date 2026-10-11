// Tests for describe.ts.
import { describe, expect, it } from 'vitest';
import { describeArguments, describeValue } from './describe';

class TypstDocument {}

describe('describeValue', () => {
  it('shows plain values and plain objects one level deep', () => {
    expect(describeValue(undefined)).toBe('undefined');
    expect(describeValue(3)).toBe('3');
    expect(describeValue('a\nb')).toBe('"a⏎b"');
    expect(describeValue({ kind: 'update', path: '/main.typ', change: { from: 1 } })).toBe('{ kind: "update", path: "/main.typ", change: {…} }');
    expect(describeValue(['/a.typ', '/b.typ'])).toBe('["/a.typ", "/b.typ"]');
  });

  it('names class instances, elements and functions instead of opening them', () => {
    expect(describeValue({ document: new TypstDocument() })).toBe('{ document: TypstDocument {…} }');
    expect(describeValue({ nodeType: 1, nodeName: 'SVG' })).toBe('<svg>');
    expect(describeValue(() => 1)).toBe('ƒ');
  });

  it('cuts long text and long lists', () => {
    expect(describeValue('x'.repeat(100))).toBe(`"${'x'.repeat(59)}…"`);
    expect(describeValue([1, 2, 3, 4, 5, 6])).toBe('[1, 2, 3, 4, …]');
    expect(describeValue({ text: 'y'.repeat(500), a: 1, b: 2, c: 3 }).length).toBeLessThanOrEqual(160);
  });
});

describe('describeArguments', () => {
  it("names a registration by its strings and its objects' names, leaving out providers and long text", () => {
    expect(describeArguments(['files.newFile', () => {}])).toBe('files.newFile');
    expect(describeArguments(['file/newFile', { command: 'files.newFile', title: 'New file…' }])).toBe('file/newFile · files.newFile');
    expect(describeArguments([{ name: 'heading', tiptap: {} }])).toBe('heading');
    expect(describeArguments([{ group: 'insert', action: { label: 'Table' } }])).toBe('insert/Table');
    expect(describeArguments([() => null, { priority: 110 }])).toBe('priority 110');
    expect(describeArguments(['.a { color: red }\n.b {}'])).toBe('(23 characters)');
  });
});
