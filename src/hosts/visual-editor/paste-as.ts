// The "Paste as" chip of the Visual editor. See clipboard.ts.
import { Extension, type AnyExtension, type Editor } from '@tiptap/core';
import { closeHistory, undo } from '@tiptap/pm/history';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { PasteChoice, PasteChoices } from '../languages/languages';
import type { Anchor, ToolbarControl, ToolbarGroup, ToolbarItem } from './visual-editor';

/** A way a paste can go in: its kind and name, and its transaction from the state before it (in place of the selection). */
export interface PasteAlternative {
  readonly kind: string;
  readonly title: string;
  paste(state: EditorState): Transaction;
}

/**
 * Pastes the first of `alternatives`, as one undo step. With more than one, the paste's choice opens: a chip floats
 * above its end (the toolbar's `paste` bar, "Paste as: Typst ▾"), whose click (or Mod+.) asks `choices` which kind it
 * goes in as; changing it undoes the paste and pastes the one picked, so one undo still takes all back. It closes on
 * the next edit, a selection outside the pasted range, or Escape.
 */
export function pasteWith(view: EditorView, alternatives: readonly PasteAlternative[]): void {
  pasteAs(view, alternatives, alternatives[0]);
}

/**
 * The paste choice of one editor, reported to `choices`, and its chip: the plugin, the toolbar's floating bar `paste`
 * (before every other bar) and its button. Without `choices`, none: a paste goes in as its first kind.
 *
 * @internal Extensions offer kinds in it through `languages.registerDocumentPasteEditProvider`.
 */
export function pasteChoice(choices: PasteChoices | null): { extensions: AnyExtension[]; bars: ToolbarGroup[]; items: ToolbarItem[] } {
  if (!choices) return { extensions: [], bars: [], items: [] };
  return {
    extensions: [Extension.create({ name: 'typstPasteAs', addProseMirrorPlugins: () => [choicePlugin(choices)] })],
    bars: [{ kind: 'floating', id: 'paste', order: 1, label: 'Paste as', anchor: (editor) => anchorOf(editor) }],
    items: [{ group: 'paste', create: ({ editor }) => chip(editor, choices) }],
  };
}

/** The open choice: the pasted range and what it may go in as. */
interface Pasted {
  readonly from: number;
  readonly to: number;
  readonly choice: PasteChoice;
}

const key = new PluginKey<Pasted | null>('typstPasteAs');

/** Pastes `alternative` of `alternatives` in place of the selection; opens the choice if there is one. */
function pasteAs(view: EditorView, alternatives: readonly PasteAlternative[], alternative: PasteAlternative): void {
  const { state } = view;
  const tr = closeHistory(alternative.paste(state));
  if (alternatives.length > 1 && tr.docChanged) {
    const choice: PasteChoice = {
      kinds: alternatives.map(({ kind, title }) => ({ kind, title })),
      kind: alternative.kind,
      change: (kind) => {
        const other = alternatives.find((each) => each.kind === kind);
        // only while open: undone, its last change is the paste
        if (key.getState(view.state)?.choice !== choice || !other || kind === choice.kind) return;
        undo(view.state, view.dispatch);
        pasteAs(view, alternatives, other);
        view.focus();
      },
    };
    tr.setMeta(key, { from: tr.mapping.map(state.selection.from, -1), to: tr.selection.to, choice } satisfies Pasted);
  }
  // no `uiEvent: paste`: Tiptap's paste rules would read what went in once more (`\*x\*` pasted as text: strong again)
  view.dispatch(tr.scrollIntoView().setMeta('paste', true));
}

/** Keeps the open choice (mapped through changes) and tells `choices` when one opens or closes. */
function choicePlugin(choices: PasteChoices): Plugin {
  return new Plugin<Pasted | null>({
    key,
    state: {
      init: () => null,
      apply: (tr, pasted) => {
        const set = tr.getMeta(key) as Pasted | null | undefined;
        if (set !== undefined) return set;
        const root = tr.getMeta('appendedTransaction') as Transaction | undefined;
        // what plugins append to the paste (an import it needs) is part of it
        if (!pasted || (tr.docChanged && !root?.getMeta(key))) return null;
        const from = tr.mapping.map(pasted.from, -1);
        const to = tr.mapping.map(pasted.to);
        const { selection } = tr;
        return selection.from < from || selection.to > to ? null : { ...pasted, from, to };
      },
    },
    props: {
      handleKeyDown: (view, event) => {
        const pasted = key.getState(view.state);
        if (!pasted) return false;
        if (event.key === 'Escape') view.dispatch(view.state.tr.setMeta(key, null));
        const pick = event.key === '.' && (event.metaKey || event.ctrlKey);
        if (pick) choices.pickPasteKind(pasted.choice);
        return pick;
      },
    },
    view: (view) => ({
      update: (_view, previous) => {
        const before = key.getState(previous)?.choice;
        const now = key.getState(view.state)?.choice;
        if (before === now) return;
        if (before) choices.closePasteChoice(before);
        if (now) choices.openPasteChoice(now);
      },
      destroy: () => {
        const open = key.getState(view.state)?.choice;
        if (open) choices.closePasteChoice(open);
      },
    }),
  });
}

/** Above the end of the pasted range, while a choice is open. */
function anchorOf(editor: Editor): Anchor {
  const pasted = key.getState(editor.state);
  if (!pasted) return null;
  try {
    const { top, left } = editor.view.coordsAtPos(pasted.to);
    return { top, left, right: left };
  } catch {
    return null; // no layout (e.g. not attached)
  }
}

/** The chip: the kind the paste went in as, a click asks for another. */
function chip(editor: Editor, choices: PasteChoices): ToolbarControl {
  const button = editor.view.dom.ownerDocument.createElement('button');
  button.type = 'button';
  button.className = 'zwf-toolbar__button zwf-toolbar__button--text';
  button.addEventListener('click', () => {
    const pasted = key.getState(editor.state);
    if (pasted) choices.pickPasteKind(pasted.choice);
  });
  return {
    element: button,
    refresh: () => {
      const choice = key.getState(editor.state)?.choice;
      const title = choice?.kinds.find(({ kind }) => kind === choice.kind)?.title ?? '';
      button.textContent = `Paste as: ${title} ▾`;
      button.setAttribute('aria-label', `Pasted as ${title}: paste as…`);
      button.title = `Pasted as ${title}: paste as… (Mod+.)`;
    },
  };
}
