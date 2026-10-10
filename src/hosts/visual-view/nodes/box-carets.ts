// Remote carets inside a box: how the presence decoration hands them to the box's node view. See raw-box.ts.
import type { Decoration } from '@tiptap/pm/view';
import type { PresenceUser } from '../../../core/typst-document/typst-document';

/** A remote caret inside a box, as the box's decoration hands it to the box: `offset` counts from the box's source start. */
export interface BoxCaret {
  id: string;
  user: PresenceUser;
  offset: number;
}

/** The decoration spec that carries `carets` to a box's node view. */
export function boxCaretsSpec(carets: BoxCaret[]): { boxCarets: BoxCaret[] } {
  return { boxCarets: carets };
}

/** The remote carets inside a box, from the decorations its node view is given. */
export function boxCarets(decorations: readonly Decoration[]): BoxCaret[] {
  return decorations.flatMap((decoration) => (decoration.spec as { boxCarets?: BoxCaret[] }).boxCarets ?? []);
}
