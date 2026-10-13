// @vitest-environment jsdom
// Tests for paste-extension.ts: a paste into a CodeMirror editor through the editor's own and the registered paste
// edit providers, and its choice of kinds (the "Paste as" chip).
import { describe, expect, it } from 'vitest';
import { history, undo } from '@codemirror/commands';
import { EditorView } from '@codemirror/view';
import { ProjectPath } from '../../core/paths/paths';
import { SourceRange } from '../../core/typst-document/typst-document';
import { LanguagesHost, type PasteChoice, type PasteChoices } from './languages';

/**
 * A CodeMirror editor of `text` with the paste extension: its own provider offers a paste as it is (`typst`) or
 * upper-cased (`text.plain`, standing in for escaped text); a registered one offers it reversed (`typst.reversed`),
 * placed by `yieldTo`, and one resolves every paste, adding `// pasted` at the top. `state.open`: the open choice.
 */
function setup(text: string, { yieldTo = ['text.plain'], preferences = ['typst'] }: { yieldTo?: string[]; preferences?: string[] } = {}) {
  const state = { open: null as PasteChoice | null, picked: [] as PasteChoice[] };
  const choices: PasteChoices = {
    openPasteChoice: (choice) => void (state.open = choice),
    closePasteChoice: (choice) => void (state.open = state.open === choice ? null : state.open),
    pickPasteKind: (choice) => void state.picked.push(choice),
  };
  const languages = new LanguagesHost({ open() {}, executeCommand: async () => undefined });
  const pastedOf = (data: DataTransfer) => data.getData('text/plain');
  languages.registerDocumentPasteEditProvider(
    {},
    { provideDocumentPasteEdits: (_document, _ranges, data) => [{ kind: 'typst.reversed', title: 'Reversed', insertText: [...pastedOf(data)].reverse().join(''), yieldTo }] },
    { providedPasteEditKinds: ['typst.reversed'], pasteMimeTypes: ['text/plain'] },
  );
  languages.registerDocumentPasteEditProvider(
    {},
    {
      resolveDocumentPasteEdit: (edit, document) =>
        document.text.startsWith('//') ? undefined : { ...edit, additionalEdit: [{ ...SourceRange.of({ from: 0, to: 0 }), insert: '// pasted\n' }] },
    },
    { providedPasteEditKinds: [] },
  );
  const provider = {
    provideDocumentPasteEdits: (_document: unknown, _ranges: unknown, data: DataTransfer) => [
      { kind: 'typst', title: 'Typst', insertText: pastedOf(data) },
      { kind: 'text.plain', title: 'Plain text', insertText: pastedOf(data).toUpperCase(), yieldTo: ['typst'] },
    ],
  };
  const parent = document.body.appendChild(document.createElement('div'));
  const view = new EditorView({
    parent,
    doc: text,
    extensions: [history(), languages.createDocumentPasteCodeMirrorExtension('typst', () => ProjectPath.of('/main.typ'), { provider, preferences, choices })],
  });
  const paste = (pasted: string) => {
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { getData: (type: string) => (type === 'text/plain' ? pasted : ''), types: ['text/plain'], files: [] } });
    view.contentDOM.dispatchEvent(event);
  };
  const key = (init: KeyboardEventInit) => view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
  return { view, state, parent, paste, key, text: () => view.state.doc.toString() };
}

describe('paste as (CodeMirror)', () => {
  it('pastes the first kind with the providers\' edits; changing it replaces both, and one undo takes it back', () => {
    const { view, state, paste, text } = setup('Text\n');
    view.dispatch({ selection: { anchor: 4 } });
    paste(' *x*');
    expect(text()).toBe('// pasted\nText *x*\n');
    expect(state.open?.kinds).toEqual([{ kind: 'typst', title: 'Typst' }, { kind: 'typst.reversed', title: 'Reversed' }, { kind: 'text.plain', title: 'Plain text' }]);
    state.open!.change('text.plain');
    expect(text()).toBe('// pasted\nText *X*\n');
    expect(state.open?.kind).toBe('text.plain');
    expect(view.state.selection.main.head).toBe('// pasted\nText *X*'.length);
    undo(view);
    expect(text()).toBe('Text\n');
    expect(state.open).toBeNull();
  });

  it('shows the kind in a chip above the paste\'s end, whose click (or Mod+.) asks for another', () => {
    const { view, state, parent, paste, key } = setup('Text\n');
    view.dispatch({ selection: { anchor: 4 } });
    paste(' x');
    const chip = parent.querySelector<HTMLButtonElement>('.typst-paste-chip')!;
    expect(chip.textContent).toBe('Paste as: Typst ▾');
    chip.click();
    key({ key: '.', ctrlKey: true });
    expect(state.picked).toEqual([state.open, state.open]);
  });

  it('closes on the next edit, a selection outside the paste, and Escape; none opens where the kinds put in the same', () => {
    const { view, state, paste, key, text } = setup('Text\n');
    const pasteAgain = () => {
      view.dispatch({ selection: { anchor: 4 } });
      paste(' x');
      expect(state.open).not.toBeNull();
    };
    pasteAgain();
    view.dispatch({ changes: { from: 0, insert: 'A' } });
    expect(state.open).toBeNull();
    pasteAgain();
    view.dispatch({ selection: { anchor: 0 } });
    expect(state.open).toBeNull();
    pasteAgain();
    key({ key: 'Escape' });
    expect(state.open).toBeNull();
    const before = text();
    paste('1');
    expect(text()).not.toBe(before);
    expect(state.open).toBeNull();
  });

  it("offers the registered providers' edits before the editor's own unless they yield, the preferred kind first", () => {
    const yielding = setup('Text\n', { yieldTo: ['typst'], preferences: [] });
    yielding.paste('ab');
    expect(yielding.state.open?.kinds.map(({ kind }) => kind)).toEqual(['typst', 'typst.reversed', 'text.plain']);
    const before = setup('Text\n', { yieldTo: [], preferences: [] });
    before.paste('ab');
    expect(before.state.open?.kinds.map(({ kind }) => kind)).toEqual(['typst.reversed', 'typst', 'text.plain']);
    const first = setup('Text\n', { yieldTo: [], preferences: ['typst.reversed'] });
    first.paste('ab');
    expect(first.text()).toBe('// pasted\nbaText\n');
    expect(first.state.open?.kinds.map(({ kind }) => kind)).toEqual(['typst.reversed', 'typst', 'text.plain']);
    first.state.open!.change('typst');
    expect(first.text()).toBe('// pasted\nabText\n');
  });
});
