// Inserting image blocks: from the toolbar, and from files pasted into the editor. See images in
// ../images.ts.
import type { Editor } from '@tiptap/core';
import type { ResolvedPos } from '@tiptap/pm/model';
import type { PathReference } from '../../../core/paths/paths';
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state';
import { imageSource } from './image-syntax';

/**
 * Inserts image blocks showing `paths` next to the selection: after the
 * selected block, or after the paragraph / heading holding it. It never
 * replaces or splits anything; only an empty paragraph is taken over. The
 * cursor ends up after the images, in a focused editor.
 */
export function insertImages(editor: Editor, paths: PathReference[]): void {
  const content = paths.map((path) => ({ type: 'image', attrs: { src: imageSource(path) } }));
  const { selection } = editor.state;
  const target = selection instanceof NodeSelection && selection.node.isBlock ? { from: selection.to, to: selection.to } : besideTextblock(selection.$to);
  editor.chain().focus().insertContentAt(target, content).run();
}

/**
 * Takes image files pasted into the editor: calls `onImages` with them.
 * Pastes without image files are left to others. Dropped files are the
 * widget's (uploaded, then made into text by the drop edit providers,
 * see images in ../images.ts).
 */
export function imageFilePastes(onImages: (files: File[]) => void): Plugin {
  return new Plugin({
    key: new PluginKey('typstImageFiles'),
    props: {
      handleDOMEvents: {
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

/** Where a block goes for `$pos`: after its textblock (instead of an empty one), else right there. */
function besideTextblock($pos: ResolvedPos): { from: number; to: number } {
  if (!$pos.parent.isTextblock || $pos.depth === 0) return { from: $pos.pos, to: $pos.pos };
  const after = $pos.after();
  return $pos.parent.content.size === 0 ? { from: $pos.before(), to: after } : { from: after, to: after };
}

function imageFiles(data: DataTransfer | null): File[] {
  return [...(data?.files ?? [])].filter((file) => file.type.startsWith('image/'));
}
