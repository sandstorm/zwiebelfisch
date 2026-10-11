// Remote carets inside a box: the presence decoration carries them to the box, whose code draws them. See
// visual-editor.ts.
import { EditorState, type Extension as CodeExtension } from '@codemirror/state';
import type { Decoration } from '@tiptap/pm/view';
import type { PresenceUser } from '../presence/presence';
import { setRawBoxDecorations } from '../../../hosts/visual-editor/visual-editor';
import { remotePresence, setPresence } from '../source-editor/source-editor';

/** A remote caret inside a box, as the box's decoration hands it to the box: `offset` counts from the box's source start. */
export interface BoxCaret {
  id: string;
  user: PresenceUser;
  offset: number;
}

/** The decoration spec that carries `carets` to a box (see `boxPresence`). */
export function boxCaretsSpec(carets: BoxCaret[]): { boxCarets: BoxCaret[] } {
  return { boxCarets: carets };
}

/**
 * Draws the remote carets a raw box's decorations carry (`boxCaretsSpec`) in the box's code, as the Source editors
 * draw theirs: whenever the box is given its decorations (`setRawBoxDecorations`), its carets replace those shown.
 */
export const boxPresence: CodeExtension = [
  remotePresence,
  EditorState.transactionExtender.of((tr) => {
    const given = tr.effects.filter((effect) => effect.is(setRawBoxDecorations));
    if (given.length === 0) return null;
    const carets = boxCarets(given[given.length - 1].value).map(({ id, user, offset }) => ({ id, user, anchor: offset, head: offset }));
    return { effects: setPresence.of(carets) };
  }),
];

/** The remote carets inside a box, from the decorations it is given. */
function boxCarets(decorations: readonly Decoration[]): BoxCaret[] {
  return decorations.flatMap((decoration) => (decoration.spec as { boxCarets?: BoxCaret[] }).boxCarets ?? []);
}
