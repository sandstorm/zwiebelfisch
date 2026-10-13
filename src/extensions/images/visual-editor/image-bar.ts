// The bar floating above a selected image: its caption and preset widths. See images in ../images.ts.
import type { Editor } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { NodeSelection, type Selection } from '@tiptap/pm/state';
import { svg, type Anchor, type ToolbarAction, type ToolbarGroup, type ToolbarItem } from '../../../hosts/visual-editor/visual-editor';
import type { WindowApi } from '../../../hosts/window/window';
import { imageArg, withImageWidth } from '../model/image-call';

/** Where the bar asks for a caption: the window's input box. */
export type ImageBarPrompts = Pick<WindowApi, 'showInputBox'>;

/** The bar floating above the selected image (as the table bar above a table), before the table's. */
export const IMAGE_BAR: ToolbarGroup = { kind: 'floating', id: 'image', order: 15, label: 'Image', anchor: (editor) => imageAnchor(editor) };

/**
 * The image bar's buttons: "Caption" (where the figures extension's commands are there; asks in the window's input
 * box) and the preset widths 25 / 50 / 75 / 100 % of the text width (the image's own pressed). Every change is one undo
 * step.
 */
export function imageBarItems(prompts: ImageBarPrompts): ToolbarItem[] {
  const caption = (editor: Editor): ToolbarAction => ({
    label: 'Caption',
    icon: CAPTION_ICON,
    click: () => void askCaption(editor, prompts),
    visible: () => {
      const image = selectedImage(editor.state.selection);
      return image !== null && captionOf(editor, image) !== undefined;
    },
  });
  const widths = PRESETS.map(
    (percent, i): ToolbarItem => ({
      group: 'image',
      order: 20 + i,
      action: {
        label: `Width ${percent}%`,
        text: `${percent}%`,
        run: (c) =>
          c.command(({ tr }) => {
            const image = selectedImage(tr.selection);
            if (!image) return false;
            const src = withImageWidth(image.node.attrs.src, percent);
            if (src !== image.node.attrs.src) tr.setNodeAttribute(image.pos, 'src', src);
            return true;
          }),
        active: (editor) => {
          const image = selectedImage(editor.state.selection);
          return image !== null && imageArg(image.node.attrs.src, 'width') === `${percent}%`;
        },
      },
    }),
  );
  return [{ group: 'image', order: 10, create: ({ editor }) => caption(editor) }, ...widths];
}

/** The selected image block and its position, if an image is selected. */
function selectedImage(selection: Selection): { node: Node; pos: number } | null {
  return selection instanceof NodeSelection && selection.node.type.name === 'image' ? { node: selection.node, pos: selection.from } : null;
}

/** Above the selected image, or null. */
function imageAnchor(editor: Editor): Anchor {
  const image = selectedImage(editor.state.selection);
  const dom = image && (editor.view.nodeDOM(image.pos) as HTMLElement | null);
  if (!dom?.getBoundingClientRect) return null;
  // above the picture where it shows (the box's heading is above it)
  const box = (dom.querySelector('.typst-images__frame') ?? dom).getBoundingClientRect();
  return { top: box.top, left: box.left, right: box.right };
}

/** The image's caption as plain text ('' without one); undefined where captions are not offered (no figures extension). */
function captionOf(editor: Editor, image: { node: Node; pos: number }): string | undefined {
  // another extension's commands: guarded, the figures may be left out
  if (!('setFigureCaption' in editor.commands) || !editor.can().setFigureCaption(image.pos, 'x')) return undefined;
  // with a caption, it follows the image in its figure
  return editor.can().removeFigureCaption(image.pos) ? (editor.state.doc.nodeAt(image.pos + image.node.nodeSize)?.textContent ?? '') : '';
}

/** Asks for the caption (plain text; an empty one removes it) and sets it. */
async function askCaption(editor: Editor, prompts: ImageBarPrompts): Promise<void> {
  const image = selectedImage(editor.state.selection);
  const current = image ? captionOf(editor, image) : undefined;
  if (!image || current === undefined) return;
  const text = (
    await prompts.showInputBox({
      title: current ? 'Edit caption' : 'Add caption',
      prompt: current ? 'Caption (empty removes it)' : 'Caption',
      value: current,
      placeHolder: 'What the image shows',
    })
  )?.trim();
  if (text !== undefined && text !== current) editor.commands.setFigureCaption(image.pos, text);
  editor.view.focus();
}

/** Width presets (keyboard-friendly resizing; any other width by dragging a handle). */
const PRESETS = [25, 50, 75, 100];

const CAPTION_ICON = svg('<rect x="4" y="3" width="16" height="12" rx="2"/><path d="M6 19h12"/>');
