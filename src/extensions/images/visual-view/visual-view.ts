// Images in the Visual view: `#image(..)` blocks and figures, what "Insert image" offers (the host's project
// files, uploads), inserting image blocks (toolbar, file drops), the image file in place of the code, and the tools
// on an image box (resize, alt text, caption), which edit the call's source minimally; `imagesVisualView` in
// images.ts registers them. See ARCHITECTURE.md, "VisualView".
import { Node } from '@tiptap/core';
import { Disposable } from '../../../core/disposable/disposable';
import { PathReference } from '../../../core/paths/paths';
import type { QuickPickItem } from '../../../hosts/window/window';
import { parenthesized } from '../../../core/typst-syntax/typst-syntax';
import { svg, type Action, type BoxRenderer, type ToolbarContext, type TypstNodeSpec } from '../../../hosts/visual-view/visual-view';
import type { ImageAssets, ImagePrompts, ImagesOptions, ImageUrls } from '../images';
import { Figure, FigureCaption, printFigure, projectFigure } from './figures';
import { imageFileDrops, insertImages } from './image-insertion';
import { imagePathLink } from './image-path-link';
import { imagePath } from './image-syntax';
import { ImageTools } from './image-tools';
import { imagePicker, uploadImages } from './image-uploads';

/**
 * A standalone `#image("path", ..)` call. Its source is kept and edited like a
 * raw block's; the box shows which image it is.
 */
const Image = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return { src: { default: '#image("")', rendered: false }, sep: { default: null, rendered: false } };
  },
  renderHTML({ node }) {
    return ['pre', { class: 'typst-visual__image' }, node.attrs.src];
  },
});

export function imageSpec(options: ImagesOptions): TypstNodeSpec {
  return {
    name: 'image',
    extension: Image,
    labelled: true,
    box: 'code',
    codeBox: {
      tools: (host, node) => {
        const links = options.imageLinks?.(host.view.document);
        const pathLabel = links && ((path: PathReference, src: string) => imagePathLink(links.linkOf(src), path, host.dom.ownerDocument, (target) => links.open(target)));
        return new ImageTools({ ...host, pathLabel, prompts: options.prompts }, node);
      },
    },
    blockCalls: {
      image: (p, call, sep) => {
        const src = p.text(call);
        return parenthesized(call.args) && imagePath(src) !== null ? p.schema.nodes.image.create({ src, sep }) : null;
      },
    },
  };
}

export const FIGURE: TypstNodeSpec = {
  name: 'figure',
  extension: Figure,
  anchors: ['layout'],
  labelled: true,
  blockCalls: { figure: projectFigure },
  print: printFigure,
};

export const FIGURE_CAPTION: TypstNodeSpec = { name: 'figureCaption', extension: FigureCaption };

/** Image boxes show their file (following path edits at once). */
export function imageRenderer(urls: ImageUrls | undefined): BoxRenderer | null {
  if (!urls) return null;
  return {
    renders: (node) => node.type.name === 'image',
    render: async (node) => {
      const path = imagePath(node.attrs.src);
      const url = path === null ? null : urls.imageUrl(path);
      return url === null ? null : { url };
    },
    followsEdits: true,
    onDidChange: urls.onDidChange,
  };
}

const ICON = svg('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 17-5-5-9 8"/>');

/** An entry of the "Insert image" pick: one of the project's images, or what else to do. */
type ImageChoice = QuickPickItem & { readonly path?: PathReference };

const UPLOAD: ImageChoice = { label: 'Upload image…' };
const ENTER_PATH: ImageChoice = { label: 'Enter a path…' };

/**
 * "Insert image": with `assets`, a quick pick of the project's images, "Upload image…" and "Enter a path…"; without,
 * an input box for the path. With `assets`, image files dropped on or pasted into the text are uploaded and inserted
 * too, and an image dragged from the file panel is inserted where it is dropped; refused uploads are error messages.
 */
export function insertImage(toolbar: ToolbarContext, assets: ImageAssets | undefined, prompts: ImagePrompts | undefined): Action {
  const { editor, root } = toolbar;
  const upload = async (files: File[], near?: number) => {
    const { paths, errors } = await uploadImages(assets!, files);
    if (paths.length > 0) insertImages(editor, paths, near);
    for (const error of errors) void prompts?.showErrorMessage(error);
  };
  const picker = imagePicker(root.ownerDocument, (files) => void upload(files));
  if (assets) {
    root.append(picker);
    const drops = imageFileDrops(
      (files, near) => upload(files, near),
      (path, near) => {
        const reference = assets.reference(path);
        if (reference !== null) insertImages(editor, [reference], near);
        return reference !== null;
      },
    );
    editor.registerPlugin(drops);
    toolbar.subscriptions.push(new Disposable(() => (editor.unregisterPlugin(drops.spec.key!), picker.remove())));
  }
  const enterPath = async (ui: ImagePrompts) => {
    const path = await ui.showInputBox({ title: 'Insert image', prompt: 'Image path', placeHolder: 'images/figure.png' });
    if (path?.trim()) insertImages(editor, [PathReference.of(path.trim())]);
    else editor.commands.focus();
  };
  const choose = async (ui: ImagePrompts) => {
    if (!assets) return enterPath(ui);
    const images: ImageChoice[] = assets.list().map((path) => ({ label: path, path }));
    const choice = await ui.showQuickPick([...images, UPLOAD, ENTER_PATH], { title: 'Insert image', placeHolder: 'Choose an image, upload one or enter a path' });
    // the picker opens within the user's gesture (choosing the entry), as browsers require
    if (choice === UPLOAD) picker.click();
    else if (choice === ENTER_PATH) await enterPath(ui);
    else if (choice?.path) insertImages(editor, [choice.path]);
    else editor.commands.focus();
  };
  return {
    label: 'Insert image',
    icon: ICON,
    run: (c) => c.insertContent({ type: 'image' }),
    click: () => void (prompts && choose(prompts)),
  };
}
