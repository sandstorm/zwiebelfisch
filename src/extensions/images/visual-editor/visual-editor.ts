// Images in the Visual editor. See docs/30_architecture/08_built-in-extensions.typ.
import { Node } from '@tiptap/core';
import { Disposable } from '../../../core/disposable/disposable';
import { PathReference, ProjectPath } from '../../../core/paths/paths';
import type { DocumentLink } from '../../../hosts/languages/languages';
import type { QuickPickItem, WindowApi } from '../../../hosts/window/window';
import type { Event } from '../../../core/event-emitter/event-emitter';
import type { TypstDocument } from '../../../core/typst-document/typst-document';
import { hasOnlyArguments, withHash } from '../../../core/typst-syntax/typst-syntax';
import { svg, type ToolbarAction, type RawBoxRenderer, type ToolbarContext, type TypstNodeSpec, type VisualEditorContribution } from '../../../hosts/visual-editor/visual-editor';
import { imageFileDrops, insertImages } from './image-insertion';
import { imagePath } from './image-syntax';
import { ImageTools } from './image-tools';
import { IMAGE_ACCEPT } from '../model/image-files';

/**
 * `#image("literal path", ..)` blocks, edited as code in a box headed "Image:
 * path", with tools (resize handles, width, alt text; a caption where the
 * figures extension offers one) and the image file in place of the code, also
 * as a figure's body; "Insert image" (a path, or the project's images and
 * uploads), and image files dropped on or pasted into the text.
 *
 * `#image(..)` blocks (also as a figure's body), what "Insert image" offers (the host's project files, uploads),
 * inserting image blocks (toolbar, file drops), the image file in place of the code, and the tools on an image box
 * (resize, alt text, the figures' caption), which edit the call's source minimally; `imagesVisualEditor` registers them
 * for images.ts.
 */
export function imagesVisualEditor(options: ImagesOptions): VisualEditorContribution {
  return {
    id: 'images',
    activate({ visualEditor, subscriptions }) {
      subscriptions.push(
        visualEditor.registerNode(imageSpec(options)),
        visualEditor.registerToolbarItem({ group: 'insert', order: 10, create: (toolbar) => insertImage(toolbar, options.assets(toolbar.document), options.prompts) }),
        // image boxes are raw boxes, too: drawn as their image file rather than as a compiled snippet (priority 100)
        visualEditor.registerRawBoxRenderer((editor) => imageRenderer(options.imageUrls(editor.document)), { priority: 110 }),
      );
    },
  };
}

/** Where images ask (an image, a path, alt text) and tell why an upload was refused: the window's. */
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
  /** The links on image paths in a document: an image box's path opens its file, or shows it is missing. */
  imageLinks(document: TypstDocument): ImageLinks;
  /** Where "Insert image" and "Alt text" ask, and refused uploads are told. */
  prompts: ImagePrompts;
}

/** The document links on the paths of a document's image calls. */
export interface ImageLinks {
  /** The (resolved) link on the path of the image call `src`, or null. */
  linkOf(src: string): DocumentLink | null;
  /** Shows a link's target. */
  open(target: ProjectPath): void;
}

/** Where the Visual editor gets images to insert from: the host's project files. */
export interface ImageAssets {
  /** The project's images, as paths to write in `#image(..)` in this document. */
  list(): PathReference[];
  /** Adds `file` to the project; resolves to the path to write in `#image(..)`, or why it was not added (in words for people). */
  upload(file: File): Promise<{ path: PathReference } | { error: string }>;
  /** The path to write in `#image(..)` in this document for the project file `path` (e.g. dragged from the file panel); null if it is no image. */
  reference(path: ProjectPath): PathReference | null;
}

function imageSpec(options: ImagesOptions): TypstNodeSpec {
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
      tools: (host, node) => {
        const links = options.imageLinks(host.editor.document);
        const pathLabel = (path: PathReference, src: string) => imagePathLink(links.linkOf(src), path, host.dom.ownerDocument, (target) => links.open(target));
        return new ImageTools({ ...host, pathLabel, prompts: options.prompts }, node);
      },
    },
  };
}

/**
 * A standalone `#image("path", ..)` call. Its source is kept and edited like a
 * raw block's; the box shows which image it is. A figure may hold it as its
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
    return ['pre', { class: 'typst-images__box' }, node.attrs.src];
  },
});

/**
 * "Insert image": a quick pick of the project's images, "Upload image…" and "Enter a path…" (an input box). Image
 * files dropped on or pasted into the text are uploaded and inserted too, and an image dragged from the file panel is
 * inserted where it is dropped; refused uploads are error messages.
 */
function insertImage(toolbar: ToolbarContext, assets: ImageAssets, prompts: ImagePrompts): ToolbarAction {
  const { editor, root } = toolbar;
  const upload = async (files: File[], near?: number) => {
    const { paths, errors } = await uploadImages(assets, files);
    if (paths.length > 0) insertImages(editor, paths, near);
    for (const error of errors) void prompts.showErrorMessage(error);
  };
  const picker = root.appendChild(imagePicker(root.ownerDocument, (files) => void upload(files)));
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
    className: 'typst-images__picture',
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
  picker.dataset.testid = 'typst-image-picker';
  picker.addEventListener('change', () => {
    const files = [...(picker.files ?? [])];
    picker.value = '';
    if (files.length > 0) choose(files);
  });
  return picker;
}

// --- An image box's path as a link to the file (the document link on it)

/** An image box's path as a button that opens the link's target, or the path marked as leading nowhere (with the link's tooltip). */
function imagePathLink(link: DocumentLink | null, path: PathReference, doc: Document, open: (target: ProjectPath) => void): HTMLElement {
  const target = link?.target;
  if (!target) {
    const missing = doc.createElement('span');
    missing.className = 'typst-images__path typst-images__path--missing';
    missing.textContent = path;
    missing.title = link?.tooltip ?? 'Outside the project';
    return missing;
  }
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'typst-images__path';
  button.textContent = path;
  button.title = `Open ${ProjectPath.displayName(target)}`;
  button.addEventListener('mousedown', (event) => event.preventDefault());
  button.addEventListener('click', () => open(target));
  return button;
}
