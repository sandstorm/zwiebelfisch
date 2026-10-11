// Images in the Visual view: `#image(..)` blocks (also as a figure's body), what "Insert image" offers (the host's project
// files, uploads), inserting image blocks (toolbar, file drops), the image file in place of the code, and the tools
// on an image box (resize, alt text, the figures' caption), which edit the call's source minimally; `imagesVisualView`
// registers them for images.ts. See docs/architecture/built-in-extensions.typ.
import { Node } from '@tiptap/core';
import { Disposable } from '../../../core/disposable/disposable';
import { PathReference, type ProjectPath } from '../../../core/paths/paths';
import type { DocumentLink } from '../../../hosts/languages/languages';
import type { QuickPickItem, Window } from '../../../hosts/window/window';
import type { Event } from '../../../core/event-emitter/event-emitter';
import type { TypstDocument } from '../../../core/typst-document/typst-document';
import { hasOnlyArguments, withHash } from '../../../core/typst-syntax/typst-syntax';
import { svg, type ToolbarAction, type RawBoxRenderer, type ToolbarContext, type TypstNodeSpec, type VisualViewContribution } from '../../../hosts/visual-view/visual-view';
import { imageFileDrops, insertImages } from './image-insertion';
import { imagePathLink } from './image-path-link';
import { imagePath } from './image-syntax';
import { ImageTools } from './image-tools';
import { imagePicker, uploadImages } from './image-uploads';

/**
 * `#image("literal path", ..)` blocks, edited as code in a box headed "Image:
 * path", with tools (resize handles, width, alt text; a caption where the
 * figures extension offers one) and the image file in place of the code, also
 * as a figure's body; "Insert image" (a path, or the project's images and
 * uploads), and image files dropped on or pasted into the text.
 */
export function imagesVisualView(options: ImagesOptions): VisualViewContribution {
  return {
    id: 'images',
    activate({ visualView, subscriptions }) {
      subscriptions.push(
        visualView.registerNode(imageSpec(options)),
        visualView.registerToolbarItem({ group: 'insert', order: 10, create: (toolbar) => insertImage(toolbar, options.assets(toolbar.document), options.prompts) }),
        // image boxes are raw boxes, too: drawn as their image file rather than as a compiled snippet (priority 100)
        visualView.registerBoxRenderer((view) => imageRenderer(options.imageUrls(view.document)), { priority: 110 }),
      );
    },
  };
}

/** Where images ask (an image, a path, alt text) and tell why an upload was refused: the window's. */
export type ImagePrompts = Pick<Window, 'showQuickPick' | 'showInputBox' | 'showErrorMessage'>;

/** Where image files are shown from: the host's project files, as URLs. */
export interface ImageUrls {
  /** A URL of the image file `path` (as written in `#image(..)`), or null if there is none. */
  imageUrl(path: PathReference): string | null;
  /** Fires whenever images may have changed. */
  readonly onDidChange: Event<void>;
}

/** What the images in a document's Visual view come from: the project and the workbench (see images.ts). */
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

/** Where the Visual view gets images to insert from: the host's project files. */
export interface ImageAssets {
  /** The project's images, as paths to write in `#image(..)` in this document. */
  list(): PathReference[];
  /** Adds `file` to the project; resolves to the path to write in `#image(..)`, or why it was not added (in words for people). */
  upload(file: File): Promise<{ path: PathReference } | { error: string }>;
  /** The path to write in `#image(..)` in this document for the project file `path` (e.g. dragged from the file panel); null if it is no image. */
  reference(path: ProjectPath): PathReference | null;
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
        const links = options.imageLinks(host.view.document);
        const pathLabel = (path: PathReference, src: string) => imagePathLink(links.linkOf(src), path, host.dom.ownerDocument, (target) => links.open(target));
        return new ImageTools({ ...host, pathLabel, prompts: options.prompts }, node);
      },
    },
  };
}

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

const ICON = svg('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 17-5-5-9 8"/>');

/** An entry of the "Insert image" pick: one of the project's images, or what else to do. */
type ImageChoice = QuickPickItem & { readonly path?: PathReference };

const UPLOAD: ImageChoice = { label: 'Upload image…' };
const ENTER_PATH: ImageChoice = { label: 'Enter a path…' };

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
    run: (c) => c.insertContent({ type: 'image' }),
    click: () => void choose(),
  };
}
