// The "Paste as" chip of the Visual editor. See clipboard.ts.
import { closeHistory, undo } from '@tiptap/pm/history';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { PasteChoice, PasteChoices } from '../paste-as';

/** A way a paste can go in: its kind and name, and its transaction from the state before it (in place of the selection). */
export interface PasteAlternative {
  readonly kind: string;
  readonly title: string;
  paste(state: EditorState): Transaction;
}

/**
 * Pastes the first of `alternatives`, as one undo step. With more than one, the paste's choice opens: a chip floats
 * above its end ("Paste as: Typst ▾", as in the Source editor), whose click (or Mod+.) asks `choices` which kind it
 * goes in as; changing it undoes the paste and pastes the one picked, so one undo still takes all back. It closes on
 * the next edit, a selection outside the pasted range, or Escape.
 */
export function pasteWith(view: EditorView, alternatives: readonly PasteAlternative[]): void {
  pasteAs(view, alternatives, alternatives[0]);
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
        // pasted again only where the undo took the paste back (no history, another change undone: none)
        if (!undo(view.state, view.dispatch) || !view.state.doc.eq(state.doc)) return;
        pasteAs(view, alternatives, other);
        view.focus();
      },
    };
    tr.setMeta(key, { from: tr.mapping.map(state.selection.from, -1), to: tr.selection.to, choice } satisfies Pasted);
  }
  // no `uiEvent: paste`: Tiptap's paste rules would read what went in once more (`\*x\*` pasted as text: strong again)
  view.dispatch(tr.scrollIntoView().setMeta('paste', true));
}

/**
 * The paste choice of one editor: keeps the open one (mapped through changes), tells `choices` when one opens or
 * closes, shows its chip, and takes its keys (Mod+. asks, Escape closes). `pasteWith` opens one.
 */
export function pasteChoicePlugin(choices: PasteChoices): Plugin {
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
    view: (view) => {
      const chip = new PasteChip(view, choices);
      return {
        update: (_view, previous) => {
          chip.show();
          const before = key.getState(previous)?.choice;
          const now = key.getState(view.state)?.choice;
          if (before === now) return;
          if (before) choices.closePasteChoice(before);
          if (now) choices.openPasteChoice(now);
        },
        destroy: () => {
          chip.dispose();
          const open = key.getState(view.state)?.choice;
          if (open) choices.closePasteChoice(open);
        },
      };
    },
  });
}

/**
 * The chip of an open choice: the kind the paste went in as ("Paste as: Typst ▾"), floating above the paste's end in
 * the text column (which scrolls with the text); a click asks `choices` for another. Presses keep the focus in the text.
 */
class PasteChip {
  private readonly bar: HTMLElement;
  private readonly button: HTMLButtonElement;

  constructor(
    private readonly view: EditorView,
    choices: PasteChoices,
  ) {
    const doc = view.dom.ownerDocument;
    this.bar = doc.createElement('div');
    this.bar.className = 'zwf-clipboard__chip-bar';
    this.bar.setAttribute('role', 'toolbar');
    this.bar.setAttribute('aria-label', 'Paste as');
    this.bar.hidden = true;
    this.bar.addEventListener('mousedown', (event) => event.preventDefault());
    this.button = this.bar.appendChild(doc.createElement('button'));
    this.button.type = 'button';
    this.button.className = 'zwf-paste-chip';
    this.button.addEventListener('click', () => {
      const pasted = key.getState(view.state);
      if (pasted) choices.pickPasteKind(pasted.choice);
    });
    (view.dom.parentElement ?? view.dom).append(this.bar);
  }

  /** Shows the open choice's kind above the paste's end; hidden while none is open. */
  show(): void {
    const pasted = key.getState(this.view.state);
    this.bar.hidden = !pasted;
    if (!pasted) return;
    const title = pasted.choice.kinds.find(({ kind }) => kind === pasted.choice.kind)?.title ?? '';
    this.button.textContent = `Paste as: ${title} ▾`;
    this.button.setAttribute('aria-label', `Pasted as ${title}: paste as…`);
    this.button.title = `Pasted as ${title}: paste as… (Mod+.)`;
    const container = this.bar.parentElement!;
    try {
      const { top, left } = this.view.coordsAtPos(pasted.to);
      const box = container.getBoundingClientRect();
      const width = this.bar.offsetWidth;
      this.bar.style.left = `${Math.max(0, Math.min(left - box.left - width / 2, container.clientWidth - width))}px`;
      // the chip's bottom 6px above the paste's end (translateY(-100%) in CSS)
      this.bar.style.top = `${top - box.top - 6}px`;
    } catch {
      // no layout (e.g. not attached): where it was
    }
  }

  dispose(): void {
    this.bar.remove();
  }
}

