// @vitest-environment jsdom
// Tests for clipboard.ts: copy, cut and paste of a Visual editor in Typst.
import { describe, expect, it } from 'vitest';
import { SourceRange, TypstDocument } from '../../core/typst-document/typst-document';
import { children } from '../../core/typst-syntax/typst-syntax';
import { starterKitPart, type TypstMarkSpec } from '../prosemirror-typst/prosemirror-typst';
import type { PasteChoice } from '../languages/languages';
import { VisualEditor, VisualEditorHost, type VisualEditorContribution, type VisualEditorPasteEdits } from './visual-editor';

/** A test-local construct beyond the host's minimum: `*strong*` as a bold mark. */
const STRONG: TypstMarkSpec = {
  name: 'bold',
  tiptap: starterKitPart('testBold', { bold: {} }),
  typst: {
    parseTypst: { syntaxNodes: { Strong: { inline: (p, node, marks) => p.inline(children(node.getChild('Markup')!), p.schema.marks.bold.create().addToSet(marks)) } } },
    toTypst: () => ({ open: '*', close: '*' }),
  },
};
const strong = { id: 'strong', activate: ({ visualEditor, subscriptions }) => subscriptions.push(visualEditor.registerMark(STRONG)) } satisfies VisualEditorContribution;

const FIGURE = '#figure(\n  mermaid(read("../diagrams/workbench-layout.mmd"), width: 75%),\n  caption: [The editor: …],\n)';

/**
 * A Visual editor of `text`; `select` selects a source range (`reveal`), `paste`, `copy`, `cut` and `key` go to its
 * text. With `pasteEdits`, a paste's choice shows (the paste edit providers leave the text as it is).
 */
function setup(text: string, pasteEdits: VisualEditorPasteEdits | null = null) {
  const parent = document.body.appendChild(document.createElement('div'));
  const doc = new TypstDocument(text);
  const host = new VisualEditorHost(null, pasteEdits);
  strong.activate({ visualEditor: host, subscriptions: [] });
  const view = new VisualEditor(parent, doc, host);
  const editable = parent.querySelector<HTMLElement>('[contenteditable]')!;
  const select = (from: number, to = from) => view.reveal(SourceRange.of({ from, to }));
  const key = (init: KeyboardEventInit) => editable.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
  const clipboardEvent = (type: string, data: FakeClipboard) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: data });
    editable.dispatchEvent(event);
    return data;
  };
  return {
    doc,
    parent,
    select,
    key,
    paste: (items: Record<string, string>) => clipboardEvent('paste', new FakeClipboard(items)),
    copy: () => clipboardEvent('copy', new FakeClipboard()),
    cut: () => clipboardEvent('cut', new FakeClipboard()),
    undo: () => key({ key: 'z', ctrlKey: true }),
  };
}

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

describe('paste', () => {
  it('reads pasted text as Typst: a call no spec models becomes a raw box with its exact source', () => {
    const { doc, parent, select, paste } = setup('Intro\n');
    select(5);
    paste({ 'text/plain': FIGURE });
    expect(doc.text).toBe(`Intro\n\n${FIGURE}\n`);
    expect(parent.querySelector('.typst-visual__raw-block')).not.toBeNull();
  });

  it('puts inline content into the text, in place of the selection', () => {
    const { doc, parent, select, paste } = setup('Some old text.\n');
    select(5, 8);
    paste({ 'text/plain': '*bold* text' });
    expect(doc.text).toBe('Some *bold* text text.\n');
    expect(parent.querySelector('strong')?.textContent).toBe('bold');
  });

  it('reads pasted inline math as a raw box in the text', () => {
    const { doc, parent, select, paste } = setup('With more\n');
    select(5);
    paste({ 'text/plain': '$x^2$ ' });
    expect(doc.text).toBe('With $x^2$ more\n');
    expect(parent.querySelector('p .typst-visual__raw-inline')).not.toBeNull();
  });

  it('is undone in one step', () => {
    const { doc, select, paste, undo } = setup('Some old text.\n');
    select(5, 8);
    paste({ 'text/plain': `*bold*\n\n${FIGURE}\n\nmore` });
    expect(doc.text).toBe(`Some *bold*\n\n${FIGURE}\n\nmore text.\n`);
    undo();
    expect(doc.text).toBe('Some old text.\n');
  });

  it('reads code a code editor copied as HTML (one preformatted block) as Typst', () => {
    const { doc, select, paste } = setup('Text\n');
    select(4);
    const html = '<meta charset="utf-8"><div style="color: #d4d4d4; white-space: pre;"><div><span>*bold*</span></div></div>';
    paste({ 'text/plain': '*bold*', 'text/html': html });
    expect(doc.text).toBe('Text*bold*\n');
  });

  it('pastes other HTML through the schema, as before', () => {
    const { doc, select, paste } = setup('Text\n');
    select(4);
    paste({ 'text/plain': '*x*', 'text/html': '<p>*x*</p>' });
    expect(doc.text).toBe('Text\\*x\\*\n');
  });

  it('pastes the text as plain characters after Mod+Shift+V', () => {
    const { doc, select, paste, key } = setup('Text\n');
    select(4);
    key({ key: 'V', code: 'KeyV', ctrlKey: true, shiftKey: true });
    paste({ 'text/plain': ' *bold*' });
    expect(doc.text).toBe('Text \\*bold\\*\n');
    paste({ 'text/plain': ' *again*' });
    expect(doc.text).toBe('Text \\*bold\\* *again*\n');
  });
});

/** Typst copied from elsewhere, with what reads it wrongly as plain text: `#`, `=`, `*`, `$`. */
const TYPST_CODE = '#set text(lang: "de")\n= Title\n\nSome *bold* $x^2$';
const MONO = 'font-family: ui-monospace, SFMono-Regular, &quot;SF Mono&quot;, Menlo, Consolas, monospace; font-size: 13.6px;';

/** Clipboard HTML of code as browsers copy it (Chromium: elements with their computed style inline). */
const SOURCES: Record<string, string> = {
  'a GitHub Markdown fence': `<meta charset='utf-8'><div class="highlight highlight-source-typst notranslate position-relative" dir="auto" style="color: rgb(31, 35, 40); font-family: -apple-system, &quot;Segoe UI&quot;, sans-serif;"><pre style="${MONO} white-space: pre; padding: 16px;"><span class="pl-k" style="color: rgb(207, 34, 46);">#set</span> text(lang: <span class="pl-s">"de"</span>)\n<span class="pl-mh">= Title</span>\n\nSome *bold* $x^2$</pre></div>`,
  'a documentation site <pre> without a language': `<div class="previewed-code"><pre><code><span class="typ-key">#set</span> <span class="typ-func">text</span>(lang: <span class="typ-str">"de"</span>)\n= Title\n\nSome *bold* $x^2$</code></pre></div>`,
  'a part of a highlighted block (spans only)': `<meta charset='utf-8'><span style="color: rgb(31, 35, 40); ${MONO} white-space: pre; background-color: rgb(246, 248, 250);"><span class="pl-k">#set</span> text(lang: "de")\n= Title\n\nSome *bold* $x^2$</span>`,
  'spans and line breaks in a monospace font': `<span style="${MONO}">#set text(lang: "de")</span><br><span style="${MONO}">= Title</span><br><br><span style="${MONO}">Some *bold* $x^2$</span>`,
  'a web code editor (a <div> per line)': `<div class="cm-line">#set text(lang: "de")</div><div class="cm-line">= Title</div><div class="cm-line"><br></div><div class="cm-line">Some *bold* $x^2$</div>`,
  'an editor of a <p> per line in a monospace font': `<p style="font-family: &quot;JetBrains Mono&quot;, monospace;">#set text(lang: "de")</p><p style="font-family: &quot;JetBrains Mono&quot;, monospace;">= Title</p><p style="font-family: &quot;JetBrains Mono&quot;, monospace;">Some *bold* $x^2$</p>`,
  'VS Code in Typst mode': `<meta charset="utf-8"><div style="color: #d4d4d4; font-family: Menlo, monospace; white-space: pre;"><div><span>#set text(lang: "de")</span></div></div>`,
};

/** No providers' paste edits, the open paste choice kept; `picked`: the choices the chip asked about. */
function choices() {
  const state = { open: null as PasteChoice | null, picked: [] as PasteChoice[] };
  const edits: VisualEditorPasteEdits = {
    prepareDocumentPaste: () => undefined,
    provideDocumentPasteEdits: () => [],
    resolveDocumentPasteEdit: (edit) => edit,
    openPasteChoice: (choice) => void (state.open = choice),
    closePasteChoice: (choice) => void (state.open = state.open === choice ? null : state.open),
    pickPasteKind: (choice) => void state.picked.push(choice),
  };
  return { state, edits };
}

describe('paste as', () => {
  it('offers the other kinds of a paste: changing it replaces the paste, and one undo takes it back', () => {
    const { state, edits } = choices();
    const { doc, select, paste, undo } = setup('Text\n', edits);
    select(4);
    paste({ 'text/plain': ' *bold* $x$' });
    expect(doc.text).toBe('Text *bold* $x$\n');
    expect(state.open?.kinds).toEqual([{ kind: 'typst', title: 'Typst' }, { kind: 'text.plain', title: 'Text' }]);
    expect(state.open?.kind).toBe('typst');
    state.open!.change('text.plain');
    expect(doc.text).toBe('Text \\*bold\\* \\$x\\$\n');
    expect(state.open?.kind).toBe('text.plain');
    state.open!.change('typst');
    expect(doc.text).toBe('Text *bold* $x$\n');
    undo();
    expect(doc.text).toBe('Text\n');
    expect(state.open).toBeNull();
  });

  it('shows the kind in a chip above the paste, whose click asks for another', () => {
    const { state, edits } = choices();
    const { parent, select, paste } = setup('Text\n', edits);
    select(4);
    paste({ 'text/plain': ' *bold*' });
    const chip = parent.querySelector<HTMLButtonElement>('[role="toolbar"][aria-label="Paste as"] button')!;
    expect(chip.textContent).toBe('Typst ▾');
    chip.click();
    expect(state.picked).toEqual([state.open]);
    state.open!.change('text.plain');
    expect(chip.textContent).toBe('Text ▾');
  });

  it('closes on the next edit, a selection outside the paste, and Escape', () => {
    const { state, edits } = choices();
    const { doc, select, paste, key } = setup('Text and more\n', edits);
    const pasteAgain = () => {
      select(4);
      paste({ 'text/plain': ' *x*' });
      expect(state.open).not.toBeNull();
    };
    pasteAgain();
    doc.setText(`${doc.text}End.\n`, 'elsewhere');
    expect(state.open).toBeNull();
    pasteAgain();
    select(0);
    expect(state.open).toBeNull();
    pasteAgain();
    const choice = state.open!;
    key({ key: 'Escape' });
    expect(state.open).toBeNull();
    // a closed choice changes nothing
    const text = doc.text;
    choice.change('text.plain');
    expect(doc.text).toBe(text);
  });

  it('opens no choice where every kind puts in the same (prose without markup characters)', () => {
    const { state, edits } = choices();
    const { doc, select, paste } = setup('Text\n', edits);
    select(4);
    paste({ 'text/plain': ' and more' });
    expect(doc.text).toBe('Text and more\n');
    expect(state.open).toBeNull();
  });

  it('pastes HTML through the schema first, and offers its text as Typst (plain text puts in the same)', () => {
    const { state, edits } = choices();
    const { doc, select, paste } = setup('Text\n', edits);
    select(4);
    paste({ 'text/plain': 'and *x*', 'text/html': '<p>and *x*</p>' });
    expect(doc.text).toBe('Textand \\*x\\*\n');
    expect(state.open?.kinds.map(({ kind }) => kind)).toEqual(['typst.html', 'typst']);
    state.open!.change('typst');
    expect(doc.text).toBe('Textand *x*\n');
  });

  it('pastes code of another language as a code block first, and offers it as Typst or HTML (plain text puts in the same)', () => {
    const { state, edits } = choices();
    const { doc, select, paste } = setup('Intro\n', edits);
    select(5);
    paste({ 'text/plain': '#x', 'text/html': '<pre><code class="language-python">#x</code></pre>' });
    expect(doc.text).toBe('Intro\n\n```python\n#x\n```\n');
    expect(state.open?.kinds.map(({ title }) => title)).toEqual(['Code block', 'Typst', 'HTML']);
    state.open!.change('typst');
    expect(doc.text).toBe('Intro#x\n');
  });

  it("offers the providers' edits after the editor's own, each as the providers resolve it", () => {
    const { state, edits } = choices();
    const provided: VisualEditorPasteEdits = {
      ...edits,
      provideDocumentPasteEdits: () => [{ kind: 'typst.loud', title: 'Loud', insertText: ' *LOUD*' }],
      resolveDocumentPasteEdit: (edit) => ({ ...edit, insertText: `${edit.insertText}!` }),
    };
    const { doc, select, paste } = setup('Text\n', provided);
    select(4);
    paste({ 'text/plain': ' x' });
    expect(doc.text).toBe('Text x!\n');
    expect(state.open?.kinds).toEqual([{ kind: 'typst', title: 'Typst' }, { kind: 'typst.loud', title: 'Loud' }]);
    state.open!.change('typst.loud');
    expect(doc.text).toBe('Text *LOUD*!\n');
  });

  it('pastes plain characters first after Mod+Shift+V, a paragraph per line, and offers Typst', () => {
    const { state, edits } = choices();
    const { doc, select, paste, key } = setup('Intro\n', edits);
    select(0);
    key({ key: 'V', code: 'KeyV', ctrlKey: true, shiftKey: true });
    paste({ 'text/plain': '= A\n*b* ' });
    expect(doc.text).toBe('\\= A\n\n\\*b\\*Intro\n');
    state.open!.change('typst');
    expect(doc.text).toBe('= A\n*b* Intro\n');
  });
});

describe('paste of code from other sources', () => {
  for (const [source, html] of Object.entries(SOURCES)) {
    it(`reads code of Typst or no language as Typst: ${source}`, () => {
      const { doc, select, paste } = setup('Intro\n');
      select(5);
      const items: Record<string, string> = { 'text/plain': TYPST_CODE.replace(/\n/g, '\r\n'), 'text/html': html };
      if (source.startsWith('VS Code')) items['vscode-editor-data'] = '{"version":1,"isFromEmptySelection":false,"mode":"typst"}';
      paste(items);
      expect(doc.text).toBe(`Intro\n\n${TYPST_CODE}\n`);
    });
  }

  it('pastes code of another language as a code block of it (a GitHub fence)', () => {
    const { doc, select, paste } = setup('Intro\n');
    select(5);
    const html = `<div class="highlight highlight-source-python notranslate"><pre style="${MONO}"><span class="pl-k">def</span> f(x):\n    <span class="pl-k">return</span> x ** 2\n</pre></div>`;
    paste({ 'text/plain': 'def f(x):\n    return x ** 2\n', 'text/html': html });
    expect(doc.text).toBe('Intro\n\n```python\ndef f(x):\n    return x ** 2\n```\n');
  });

  it("pastes code VS Code copied in another language mode as a code block of it, its fence longer than the code's backticks", () => {
    const { doc, select, paste } = setup('Intro\n');
    select(5);
    const html = '<meta charset="utf-8"><div style="white-space: pre;"><div><span>s = """```"""</span></div></div>';
    paste({ 'text/plain': 's = """```"""', 'text/html': html, 'vscode-editor-data': '{"version":1,"mode":"python"}' });
    expect(doc.text).toBe('Intro\n\n````python\ns = """```"""\n````\n');
  });

  it('reads code a language class names Typst or plain text as Typst', () => {
    for (const language of ['typ', 'typst', 'text']) {
      const { doc, select, paste } = setup('Text\n');
      select(4);
      paste({ 'text/plain': ' *bold*', 'text/html': `<pre><code class="language-${language}"> *bold*</code></pre>` });
      expect(doc.text).toBe('Text *bold*\n');
    }
  });

  it('pastes HTML with text outside code (prose with inline code, text only wrapped) through the schema', () => {
    for (const html of ['<p>Use <code>*x*</code> here</p>', '<span style="white-space: pre-wrap;">*x*</span>']) {
      const { doc, select, paste } = setup('Text\n');
      select(4);
      paste({ 'text/plain': '*x*', 'text/html': html });
      expect(doc.text).toContain('\\*x\\*');
    }
  });
});

describe('copy', () => {
  it('puts the Typst source of the selection on the clipboard as text, and HTML along', () => {
    const source = 'Some *bold* text.\n';
    const { select, copy } = setup(source);
    select(0, source.indexOf('.'));
    const data = copy();
    expect(data.getData('text/plain')).toBe('Some *bold* text');
    expect(data.getData('text/html')).toContain('<strong>bold</strong>');
  });

  it('copies raw boxes byte for byte', () => {
    const source = `Intro\n\n${FIGURE}\n\nEnd.\n`;
    const { select, copy } = setup(source);
    select(0, source.length - 1);
    expect(copy().getData('text/plain')).toBe(source.trimEnd());
  });

  it('prints a selection anew where its source would not read the same (part of a bold word)', () => {
    const source = 'Some *bold* text.\n';
    const { select, copy } = setup(source);
    select(source.indexOf('ld'), source.indexOf(' text'));
    expect(copy().getData('text/plain')).toBe('*ld*');
  });

  it('cuts the selection, its Typst on the clipboard', () => {
    const source = 'Some *bold* text.\n';
    const { doc, select, cut } = setup(source);
    select(4, source.indexOf('.'));
    expect(cut().getData('text/plain')).toBe(' *bold* text');
    expect(doc.text).toBe('Some.\n');
  });

  it('cuts the paragraph at the cursor when nothing is selected, as IntelliJ cuts the line', () => {
    const source = 'One.\n\nSome *bold* text.\n\nThree.\n';
    const { doc, select, cut } = setup(source);
    select(source.indexOf('bold'));
    expect(cut().getData('text/plain')).toBe('Some *bold* text.');
    expect(doc.text).toBe('One.\n\nThree.\n');
  });

  it('round-trips: what is copied pastes back byte for byte, as Typst text and as HTML', () => {
    const source = `Some *bold* text, an escaped \\* star.\n\n= A heading (raw here)\n\n${FIGURE}\n\nEnd.\n`;
    const { select, copy } = setup(source);
    select(0, source.length - 1);
    const data = copy();
    expect(data.getData('text/plain')).toBe(source.trimEnd());
    for (const items of [{ 'text/plain': data.getData('text/plain') }, Object.fromEntries(data.items)]) {
      const target = setup('');
      target.select(0);
      target.paste(items);
      expect(target.doc.text).toBe(source.trimEnd());
    }
  });
});
