// @vitest-environment jsdom
// Tests for paste-extension.ts: a paste into a CodeMirror editor through the paste edit providers, and its choice of
// kinds (the "Paste as" chip).
import { describe, expect, it } from 'vitest';
import { history, undo } from '@codemirror/commands';
import { EditorView } from '@codemirror/view';
import { ProjectPath } from '../../core/paths/paths';
import { SourceRange } from '../../core/typst-document/typst-document';
import { LanguagesHost, type PasteChoice, type PasteChoices } from './languages';

/**
 * A CodeMirror editor of `text` with the paste extension: a paste goes in as it is (`typst`) or upper-cased
 * (`text.plain`, standing in for escaped text); a provider adds `// pasted` at the top. `state.open`: the open choice.
 */
function setup(text: string) {
  const state = { open: null as PasteChoice | null, picked: [] as PasteChoice[] };
  const choices: PasteChoices = {
    openPasteChoice: (choice) => void (state.open = choice),
    closePasteChoice: (choice) => void (state.open = state.open === choice ? null : state.open),
    pickPasteKind: (choice) => void state.picked.push(choice),
  };
  const languages = new LanguagesHost({ open() {}, executeCommand: async () => undefined });
  languages.registerDocumentPasteEditProvider({}, {
    provideDocumentPasteEdits: (document, _ranges, pasted) => (document.text.startsWith('//') ? undefined : { insertText: pasted, additionalEdits: [{ ...SourceRange.of({ from: 0, to: 0 }), insert: '// pasted\n' }] }),
  });
  const kinds = (pasted: string) => [
    { kind: 'typst', title: 'Typst', text: pasted },
    { kind: 'text.plain', title: 'Text', text: pasted.toUpperCase() },
  ];
  const parent = document.body.appendChild(document.createElement('div'));
  const view = new EditorView({
    parent,
    doc: text,
    extensions: [history(), languages.createDocumentPasteCodeMirrorExtension('typst', () => ProjectPath.of('/main.typ'), { kinds, choices })],
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
    expect(state.open?.kinds).toEqual([{ kind: 'typst', title: 'Typst' }, { kind: 'text.plain', title: 'Text' }]);
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
    expect(chip.textContent).toBe('Typst ▾');
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
    paste(' 1');
    expect(text()).not.toBe(before);
    expect(state.open).toBeNull();
  });
});
