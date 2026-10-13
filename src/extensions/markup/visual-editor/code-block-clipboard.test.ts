// @vitest-environment jsdom
// Tests for copy and paste in and out of a code block of a Visual editor (with the other built-ins, as in the widget).
import { describe, expect, it } from 'vitest';
import { SourceRange, TypstDocument } from '../../../core/typst-document/typst-document';
import { createVisualEditor } from '../../../testing/testing';

/** The part of DataTransfer the editor uses (jsdom has none). */
class FakeClipboard {
  readonly items: Map<string, string>;
  readonly files: File[] = [];
  constructor(items: Record<string, string> = {}) {
    this.items = new Map(Object.entries(items));
  }
  getData(type: string): string {
    return this.items.get(type) ?? '';
  }
  setData(type: string, value: string): void {
    this.items.set(type, value);
  }
  clearData(): void {
    this.items.clear();
  }
  get types(): string[] {
    return [...this.items.keys()];
  }
}

/** A Visual editor of `text`; `select` selects a source range, `copy` and `paste` go to its text. */
function setup(text: string) {
  const parent = document.body.appendChild(document.createElement('div'));
  const doc = new TypstDocument(text);
  const view = createVisualEditor(parent, doc);
  const editable = parent.querySelector<HTMLElement>('[contenteditable]')!;
  const clipboardEvent = (type: string, data: FakeClipboard) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: data });
    editable.dispatchEvent(event);
    return data;
  };
  return {
    doc,
    parent,
    select: (from: number, to = from) => view.reveal(SourceRange.of({ from, to })),
    copy: () => clipboardEvent('copy', new FakeClipboard()),
    paste: (items: Record<string, string>) => clipboardEvent('paste', new FakeClipboard(items)),
  };
}

const CODE = '```js\nlet a = *b*;\nlet c = 1;\n```';

describe('a code block in a Visual editor', () => {
  it('copies text selected within it as that text, without fences', () => {
    const source = `Intro\n\n${CODE}\n`;
    const { select, copy } = setup(source);
    select(source.indexOf('a ='), source.indexOf(' = 1'));
    const data = copy();
    expect(data.getData('text/plain')).toBe('a = *b*;\nlet c');
    expect(data.getData('text/x-typst')).toBe('a = *b*;\nlet c');
    expect(data.getData('text/html')).not.toContain('```');
  });

  it('copies all of its text as that text', () => {
    const source = `${CODE}\n`;
    const { select, copy } = setup(source);
    select(source.indexOf('let a'), source.indexOf('\n```'));
    expect(copy().getData('text/plain')).toBe('let a = *b*;\nlet c = 1;');
  });

  it('copies it whole, with fences, together with the paragraphs around it', () => {
    const source = `Intro\n\n${CODE}\n\nEnd.\n`;
    const { select, copy } = setup(source);
    select(0, source.length - 1);
    expect(copy().getData('text/plain')).toBe(source.trimEnd());
  });

  it('pastes its copied text into another code block literally', () => {
    const source = `${CODE}\n`;
    const from = setup(source);
    from.select(source.indexOf('let a'), source.indexOf('\n```'));
    const data = from.copy();
    const target = setup('```\nx\n```\n');
    target.select(5);
    target.paste(Object.fromEntries(data.items));
    expect(target.doc.text).toBe('```\nxlet a = *b*;\nlet c = 1;\n```\n');
  });

  it('pastes text with fences into a code block as it is', () => {
    const target = setup('```\nx\n```\n');
    target.select(5);
    target.paste({ 'text/plain': '```py\ny\n```', 'text/x-typst': '```py\ny\n```' });
    expect(target.doc.text).toBe('````\nx```py\ny\n```\n````\n');
  });

  it('is what code of another language than Typst pastes as (VS Code in Python mode), in the middle of a paragraph', () => {
    const target = setup('Some text.\n');
    target.select(4);
    const html = '<meta charset="utf-8"><div style="white-space: pre;"><div><span>def f(x):</span></div><div><span>    return x</span></div></div>';
    target.paste({ 'text/plain': 'def f(x):\r\n    return x', 'text/html': html, 'vscode-editor-data': '{"version":1,"mode":"python"}' });
    expect(target.doc.text).toBe('Some\n\n```python\ndef f(x):\n    return x\n```\n\n text.\n');
    expect(target.parent.querySelector('.typst-markup__code-block')?.textContent).toContain('return x');
  });
});
