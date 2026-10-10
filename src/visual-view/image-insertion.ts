import type { Editor } from '@tiptap/core';
import type { ResolvedPos } from '@tiptap/pm/model';
import { NodeSelection } from '@tiptap/pm/state';
import { imageSource } from './projection';

/**
 * Inserts an image block showing `path` next to the selection, or next to
 * document position `near` (e.g. where a file was dropped): after the
 * selected block, or after the paragraph / heading holding that position.
 * It never replaces or splits anything; only an empty paragraph is taken
 * over. The cursor ends up after the image, in a focused editor.
 */
export function insertImageBlock(editor: Editor, path: string, near?: number): void {
  const { state } = editor;
  const content = { type: 'image', attrs: { src: imageSource(path) } };
  const { selection } = state;
  const target =
    near === undefined
      ? selection instanceof NodeSelection && selection.node.isBlock
        ? { from: selection.to, to: selection.to }
        : besideTextblock(selection.$to)
      : besideTextblock(state.doc.resolve(near));
  editor.chain().focus().insertContentAt(target, content).run();
}

/** Where a block goes for `$pos`: after its textblock (instead of an empty one), else right there. */
function besideTextblock($pos: ResolvedPos): { from: number; to: number } {
  if (!$pos.parent.isTextblock || $pos.depth === 0) return { from: $pos.pos, to: $pos.pos };
  const after = $pos.after();
  return $pos.parent.content.size === 0 ? { from: $pos.before(), to: after } : { from: after, to: after };
}
