// Other users' places in CodeMirror (Source editors, raw boxes' code) and per-user undo. See collaboration in
// ../collaboration.ts.
import { EditorState, Facet, StateEffect, StateField, Transaction, type Extension, type Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet } from '@codemirror/view';
import type { TypstDocument } from '../../../core/typst-document/typst-document';
import { fromDocument } from '../../../hosts/source-editor/source-editor';
import { REMOTE_ORIGIN } from '../remote-origin';
import type { Presence, PresenceSource, PresenceUser } from '../presence/presence';
import { textColorOn } from '../../../core/color-scheme/color-scheme';

/**
 * Undo is per user: other users' edits (changes with `REMOTE_ORIGIN`) never enter a Source editor's history; it maps
 * over them, so Undo reverts the local user's last edit only (also one made in the Visual editor).
 */
export const perUserUndo: Extension = EditorState.transactionExtender.of((tr) =>
  tr.annotation(fromDocument)?.origin === REMOTE_ORIGIN ? { annotations: Transaction.addToHistory.of(false) } : null,
);

/** Draws the other users' carets and selections in every Source editor, as `presences` has them; they follow edits. */
export function sourcePresence(presences: PresenceSource): (editor: { readonly document: TypstDocument }) => Extension {
  return (editor) => [
    remotePresence,
    initialPresences.of(presences.presencesIn(editor.document)),
    ViewPlugin.define((view) => {
      const subscription = presences.onDidChange(() => view.dispatch({ effects: setPresence.of(presences.presencesIn(editor.document)) }));
      return { destroy: () => subscription.dispose() };
    }),
  ];
}

/** Shows these presences (offsets in the editor's text) in an editor with `remotePresence`, replacing the ones shown. */
export const setPresence = StateEffect.define<readonly Presence[]>();

/**
 * Other users' carets and selections in a CodeMirror view, in the style of
 * y-codemirror: a bar in the user's color (name on hover, and briefly after
 * each move), the selection tinted in that color. Also on empty lines.
 * Shows what `setPresence` gives it.
 */
export const remotePresence: Extension = StateField.define<readonly Shown[]>({
  create: (state) => arrive([], state.facet(initialPresences), state.doc.length),
  update(shown, tr) {
    let next = tr.docChanged
      ? shown.map((p) => ({ ...p, anchor: tr.changes.mapPos(p.anchor, 1), head: tr.changes.mapPos(p.head, 1) }))
      : shown;
    for (const effect of tr.effects) if (effect.is(setPresence)) next = arrive(next, effect.value, tr.newDoc.length);
    return next;
  },
  provide: (field) => EditorView.decorations.compute([field], (state) => decorations(state, state.field(field))),
});

/**
 * A remote caret: a thin bar in the user's color with a flag naming them (the look of Tiptap's CollaborationCaret /
 * y-codemirror). The flag is drawn from `data-user` (CSS), no text: the editor's text stays the document's (for find
 * in the page, `textContent`). Styling decides whether the flag always shows or only on hover and right after a move.
 */
export function caretElement(doc: Document, user: PresenceUser): HTMLElement {
  const caret = doc.createElement('span');
  caret.className = 'zwf-collaboration__caret';
  caret.dataset.user = user.name;
  caret.setAttribute('aria-hidden', 'true');
  caret.contentEditable = 'false';
  presenceStyle(caret, user);
  return caret;
}

/** What a new editor shows before the first `setPresence` (the places when it was made). */
const initialPresences = Facet.define<readonly Presence[], readonly Presence[]>({ combine: (values) => values.at(-1) ?? [] });

/** A presence as shown: `moves` counts how often its caret moved (a move shows the name flag again). */
interface Shown extends Presence {
  moves: number;
}

/** The new presences, clamped to the text; a caret that moved (or is new) counts one more move. */
function arrive(before: readonly Shown[], presences: readonly Presence[], length: number): Shown[] {
  return presences.map((presence) => {
    const anchor = Math.min(Math.max(presence.anchor, 0), length);
    const head = Math.min(Math.max(presence.head, 0), length);
    const previous = before.find((p) => p.id === presence.id);
    const moves = previous ? previous.moves + (previous.head === head ? 0 : 1) : 0;
    return { ...presence, anchor, head, moves };
  });
}

function decorations(state: EditorState, shown: readonly Shown[]): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  for (const presence of shown) {
    const from = Math.min(presence.anchor, presence.head);
    const to = Math.max(presence.anchor, presence.head);
    if (from < to) ranges.push(selectionMark(presence.user).range(from, to));
    ranges.push(Decoration.widget({ widget: new CaretWidget(presence.user, presence.moves), side: 1 }).range(presence.head));
  }
  return Decoration.set(ranges.filter((range) => range.to <= state.doc.length), true);
}

function selectionMark(user: PresenceUser): Decoration {
  return Decoration.mark({
    class: 'zwf-collaboration__selection',
    attributes: { 'data-user': user.name, style: `--zwf-remote-color: ${user.color}` },
  });
}

/** The caret widget. Equal while user and move count are the same, so CodeMirror keeps its DOM (and the flag stays hidden). */
class CaretWidget extends WidgetType {
  constructor(
    private readonly user: PresenceUser,
    private readonly moves: number,
  ) {
    super();
  }

  eq(other: CaretWidget): boolean {
    return other.user.name === this.user.name && other.user.color === this.user.color && other.moves === this.moves;
  }

  toDOM(view: EditorView): HTMLElement {
    const caret = caretElement(view.dom.ownerDocument, this.user);
    // The flag shows briefly after a move, then on hover only.
    caret.classList.add('zwf-collaboration__caret--transient');
    return caret;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/** CSS custom properties for elements drawn in a user's color: the color and a readable text color on it. */
function presenceStyle(element: HTMLElement, user: PresenceUser): void {
  element.style.setProperty('--zwf-remote-color', user.color);
  element.style.setProperty('--zwf-remote-text', textColorOn(user.color));
}
