import { StateEffect, StateField, type EditorState, type Extension, type Range } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import { caretElement, type Presence, type PresenceUser } from '../../core/typst-document/typst-document';

const setPresence = StateEffect.define<readonly Presence[]>();

/** A presence as shown: `moves` counts how often its caret moved (a move shows the name flag again). */
interface Shown extends Presence {
  moves: number;
}

/**
 * Other users' carets and selections in a CodeMirror view, in the style of
 * y-codemirror: a bar in the user's color (name on hover, and briefly after
 * each move), the selection tinted in that color. Also on empty lines.
 */
export const remotePresence: Extension = StateField.define<readonly Shown[]>({
  create: () => [],
  update(shown, tr) {
    let next = tr.docChanged
      ? shown.map((p) => ({ ...p, anchor: tr.changes.mapPos(p.anchor, 1), head: tr.changes.mapPos(p.head, 1) }))
      : shown;
    for (const effect of tr.effects) if (effect.is(setPresence)) next = arrive(next, effect.value, tr.newDoc.length);
    return next;
  },
  provide: (field) => EditorView.decorations.compute([field], (state) => decorations(state, state.field(field))),
});

/** Shows `presences` (offsets in the view's text) in `view`, replacing the ones shown before. */
export function showPresence(view: EditorView, presences: readonly Presence[]): void {
  view.dispatch({ effects: setPresence.of(presences) });
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
    class: 'typst-remote-selection',
    attributes: { 'data-user': user.name, style: `--typst-remote-color: ${user.color}` },
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
    caret.classList.add('typst-remote-caret--transient');
    return caret;
  }

  ignoreEvent(): boolean {
    return false;
  }
}
