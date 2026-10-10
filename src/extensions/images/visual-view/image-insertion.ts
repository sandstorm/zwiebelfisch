// Inserting image blocks: from the toolbar, and from files dropped on the editor. See images.ts.
import type { Editor } from '@tiptap/core';
import type { ResolvedPos } from '@tiptap/pm/model';
import { type PathReference, ProjectPath } from '../../../core/paths/paths';
import { PROJECT_PATH_TYPE } from '../../../core/project/project';
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state';
import { imageSource } from './image-syntax';

/**
 * Inserts image blocks showing `paths` next to the selection, or next to
 * document position `near` (e.g. where files were dropped): after the
 * selected block, or after the paragraph / heading holding that position.
 * It never replaces or splits anything; only an empty paragraph is taken
 * over. The cursor ends up after the images, in a focused editor.
 */
export function insertImages(editor: Editor, paths: PathReference[], near?: number): void {
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
 * place of the page and the file panel does not add it once more. Events
 * without image files are left to others (e.g. the file panel).
 *
 * A project file dragged from the file panel (`PROJECT_PATH_TYPE`) goes to
 * `onProjectFile` with its path and the drop position instead; it returns
 * whether it took the file (only images).
 */
export function imageFileDrops(
  onImages: (files: File[], near?: number) => void,
  onProjectFile?: (path: ProjectPath, near?: number) => boolean,
): Plugin {
  const carriesProjectFile = (event: DragEvent) => !!onProjectFile && !!event.dataTransfer?.types.includes(PROJECT_PATH_TYPE);
  return new Plugin({
    key: new PluginKey('typstImageFiles'),
    props: {
      handleDOMEvents: {
        dragover: (_view, event) => {
          // the browser only drops what a dragover accepted (the data itself is readable on drop only)
          if (!carriesProjectFile(event)) return false;
          event.preventDefault();
          event.dataTransfer!.dropEffect = 'copy';
          return true;
        },
        drop: (view, event) => {
          const near = () => view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
          if (carriesProjectFile(event)) {
            event.preventDefault();
            event.stopPropagation();
            const path = ProjectPath.parse(event.dataTransfer!.getData(PROJECT_PATH_TYPE));
            return path !== null && onProjectFile!(path, near());
          }
          const files = imageFiles(event.dataTransfer);
          if (files.length === 0) return false;
          event.preventDefault();
          event.stopPropagation();
          onImages(files, near());
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
