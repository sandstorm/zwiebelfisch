import type { Editor } from '@tiptap/core';
import type { ResolvedPos } from '@tiptap/pm/model';
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state';
import { imageSource } from './projection';

/**
 * Inserts image blocks showing `paths` next to the selection, or next to
 * document position `near` (e.g. where files were dropped): after the
 * selected block, or after the paragraph / heading holding that position.
 * It never replaces or splits anything; only an empty paragraph is taken
 * over. The cursor ends up after the images, in a focused editor.
 */
export function insertImages(editor: Editor, paths: string[], near?: number): void {
  const { state } = editor;
  const content = paths.map((path) => ({ type: 'image', attrs: { src: imageSource(path) } }));
  const { selection } = state;
  const target =
    near === undefined
      ? selection instanceof NodeSelection && selection.node.isBlock
        ? { from: selection.to, to: selection.to }
        : besideTextblock(selection.$to)
      : // Uploads take a while: the document may have shrunk since.
        besideTextblock(state.doc.resolve(Math.min(near, state.doc.content.size)));
  editor.chain().focus().insertContentAt(target, content).run();
}

/** Where a block goes for `$pos`: after its textblock (instead of an empty one), else right there. */
function besideTextblock($pos: ResolvedPos): { from: number; to: number } {
  if (!$pos.parent.isTextblock || $pos.depth === 0) return { from: $pos.pos, to: $pos.pos };
  const after = $pos.after();
  return $pos.parent.content.size === 0 ? { from: $pos.before(), to: after } : { from: after, to: after };
}

/**
 * Takes image files dropped on or pasted into the editor: calls `onImages`
 * with them (and, for a drop, the document position under the mouse). The
 * event goes no further, so the browser does not open a dropped file in
 * place of the page and the file bar does not add it once more. Events
 * without image files are left to others (e.g. the file bar).
 */
export function imageFileDrops(onImages: (files: File[], near?: number) => void): Plugin {
  return new Plugin({
    key: new PluginKey('typstImageFiles'),
    props: {
      handleDOMEvents: {
        drop: (view, event) => {
          const files = imageFiles(event.dataTransfer);
          if (files.length === 0) return false;
          event.preventDefault();
          event.stopPropagation();
          onImages(files, view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos);
          return true;
        },
        paste: (_view, event) => {
          const files = imageFiles(event.clipboardData);
          if (files.length === 0) return false;
          event.preventDefault();
          onImages(files);
          return true;
        },
      },
    },
  });
}

function imageFiles(data: DataTransfer | null): File[] {
  return [...(data?.files ?? [])].filter((file) => file.type.startsWith('image/'));
}
