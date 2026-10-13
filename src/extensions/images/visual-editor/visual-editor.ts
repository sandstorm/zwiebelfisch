// Images in the Visual editor. See images in ../images.ts.
import { Node } from '@tiptap/core';
import { Disposable } from '../../../core/disposable/disposable';
import { PathReference } from '../../../core/paths/paths';
import type { QuickPickItem, WindowApi } from '../../../hosts/window/window';
import type { Event } from '../../../core/event-emitter/event-emitter';
import type { TypstDocument } from '../../../core/typst-document/typst-document';
import { hasOnlyArguments, withHash } from '../../../core/typst-syntax/typst-syntax';
import { svg, type ToolbarAction, type RawBoxRenderer, type ToolbarContext, type TypstNodeSpec, type VisualEditorContribution } from '../../../hosts/visual-editor/visual-editor';
import { imageFilePastes, insertImages } from './image-insertion';
import { imagePath } from './image-syntax';
import { IMAGE_BAR, imageBarItems } from './image-bar';
import { ImageTools } from './image-tools';
import { IMAGE_ACCEPT } from '../model/image-files';

/**
 * `#image("literal path", ..)` blocks, edited as code in a box, with the image
 * file in place of the code and resize handles (its path's link followed on the
 * picture, as on every box's), also as
 * a figure's body; a bar above the selected image (width; a caption where the
 * figures extension offers one); "Insert image" (a path, or the project's
 * images and uploads), and image files pasted into the text.
 */
export function imagesVisualEditor(options: ImagesOptions): VisualEditorContribution {
  return {
    id: 'images',
    activate({ visualEditor, subscriptions }) {
      subscriptions.push(
        visualEditor.registerNode(imageSpec()),
        visualEditor.registerToolbarGroup(IMAGE_BAR),
        ...imageBarItems(options.prompts).map((item) => visualEditor.registerToolbarItem(item)),
        visualEditor.registerToolbarItem({ group: 'insert', order: 10, create: (toolbar) => insertImage(toolbar, options.assets(toolbar.document), options.prompts) }),
        // image boxes are raw boxes, too: drawn as their image file rather than as a compiled snippet (priority 100)
        visualEditor.registerRawBoxRenderer((editor) => imageRenderer(options.imageUrls(editor.document)), { priority: 110 }),
      );
    },
  };
}

/** Where images ask (an image, a path, a caption, a width) and tell why an upload was refused: the window's. */
export type ImagePrompts = Pick<WindowApi, 'showQuickPick' | 'showInputBox' | 'showErrorMessage'>;

/** Where image files are shown from: the host's project files, as URLs. */
export interface ImageUrls {
  /** A URL of the image file `path` (as written in `#image(..)`), or null if there is none. */
  imageUrl(path: PathReference): string | null;
  /** Fires whenever images may have changed. */
  readonly onDidChange: Event<void>;
}

/** What the images in a document's Visual editor come from: the project and the workbench (see images.ts). */
export interface ImagesOptions {
  /** What "Insert image" offers in a document: the project's images and uploads. */
  assets(document: TypstDocument): ImageAssets;
  /** Image files shown in place of the call while it is not edited. */
  imageUrls(document: TypstDocument): ImageUrls;
  /** Where "Insert image" and the image tools ask, and refused uploads are told. */
  prompts: ImagePrompts;
}

/** Where the Visual editor gets images to insert from: the host's project files. */
export interface ImageAssets {
  /** The project's images, as paths to write in `#image(..)` in this document. */
  list(): PathReference[];
  /** Adds `file` to the project; resolves to the path to write in `#image(..)`, or why it was not added (in words for people). */
  upload(file: File): Promise<{ path: PathReference } | { error: string }>;
}

function imageSpec(): TypstNodeSpec {
  return {
    name: 'image',
    tiptap: Image,
    typst: {
      parseTypst: {
        calls: {
          image: {
            block: (p, call, sep) => {
              const src = p.text(withHash(call));
              return hasOnlyArguments(call) && imagePath(src) !== null ? p.schema.nodes.image.create({ src, sep }) : null;
            },
          },
        },
      },
      labelled: true,
    },
    view: {
      box: 'code',
      tools: (host, node) => new ImageTools(host, node),
    },
  };
}

/**
 * A standalone `#image("path", ..)` call. Its source is kept and edited like a
 * raw block's; the box shows the image. A figure may hold it as its
 * body (`figureBody`), the call then written without `#`.
 */
const Image = Node.create({
  name: 'image',
  group: 'block figureBody',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return { src: { default: '#image("")', rendered: false }, sep: { default: null, rendered: false } };
  },
  renderHTML({ node }) {
    return ['pre', { class: 'zwf-images__box' }, node.attrs.src];
  },
});

/**
 * "Insert image": a quick pick of the project's images, "Upload image…" and "Enter a path…" (an input box). Image
 * files pasted into the text are uploaded and inserted too; refused uploads are error messages.
 */
function insertImage(toolbar: ToolbarContext, assets: ImageAssets, prompts: ImagePrompts): ToolbarAction {
  const { editor, root } = toolbar;
  const upload = async (files: File[]) => {
    const { paths, errors } = await uploadImages(assets, files);
    if (paths.length > 0) insertImages(editor, paths);
    for (const error of errors) void prompts.showErrorMessage(error);
  };
  const picker = root.appendChild(imagePicker(root.ownerDocument, (files) => void upload(files)));
  const pastes = imageFilePastes((files) => void upload(files));
  editor.registerPlugin(pastes);
  toolbar.subscriptions.push(new Disposable(() => (editor.unregisterPlugin(pastes.spec.key!), picker.remove())));
  const enterPath = async () => {
    const path = await prompts.showInputBox({ title: 'Insert image', prompt: 'Image path', placeHolder: 'images/figure.png' });
    if (path?.trim()) insertImages(editor, [PathReference.of(path.trim())]);
    else editor.commands.focus();
  };
  const choose = async () => {
    const images: ImageChoice[] = assets.list().map((path) => ({ label: path, path }));
    const choice = await prompts.showQuickPick([...images, UPLOAD, ENTER_PATH], { title: 'Insert image', placeHolder: 'Choose an image, upload one or enter a path' });
    // the picker opens within the user's gesture (choosing the entry), as browsers require
    if (choice === UPLOAD) picker.click();
    else if (choice === ENTER_PATH) await enterPath();
    else if (choice?.path) insertImages(editor, [choice.path]);
    else editor.commands.focus();
  };
  return {
    label: 'Insert image',
    icon: ICON,
    keywords: ['picture', 'photo', 'figure'],
    run: (c) => c.insertContent({ type: 'image' }),
    click: () => void choose(),
  };
}

/** An entry of the "Insert image" pick: one of the project's images, or what else to do. */
type ImageChoice = QuickPickItem & { readonly path?: PathReference };

const UPLOAD: ImageChoice = { label: 'Upload image…' };
const ENTER_PATH: ImageChoice = { label: 'Enter a path…' };

const ICON = svg('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 17-5-5-9 8"/>');

/** Image boxes show their file (following path edits at once). */
function imageRenderer(urls: ImageUrls): RawBoxRenderer {
  return {
    renders: (node) => node.type.name === 'image',
    render: async (node) => {
      const path = imagePath(node.attrs.src);
      const url = path === null ? null : urls.imageUrl(path);
      return url === null ? null : { url };
    },
    followsEdits: true,
    className: 'zwf-images__picture',
    onDidChange: urls.onDidChange,
  };
}

// --- Image uploads: image files from the computer, picked for "Insert image" or dropped, added to the project one by one

/** Uploads `files` one by one: the paths of those added, and why the others were not. */
async function uploadImages(assets: ImageAssets, files: readonly File[]): Promise<{ paths: PathReference[]; errors: string[] }> {
  const paths: PathReference[] = [];
  const errors: string[] = [];
  for (const file of files) {
    const result = await assets.upload(file);
    if ('path' in result) paths.push(result.path);
    else errors.push(result.error);
  }
  return { paths, errors };
}

/** A hidden file input for the image formats Typst can show (others would only be refused after picking); `choose` gets what was picked. */
function imagePicker(doc: Document, choose: (files: File[]) => void): HTMLInputElement {
  const picker = doc.createElement('input');
  picker.type = 'file';
  picker.accept = IMAGE_ACCEPT;
  picker.multiple = true;
  picker.hidden = true;
  picker.dataset.testid = 'zwf-image-picker';
  picker.addEventListener('change', () => {
    const files = [...(picker.files ?? [])];
    picker.value = '';
    if (files.length > 0) choose(files);
  });
  return picker;
}
