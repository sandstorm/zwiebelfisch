// Images in the Visual view: `#image(..)` blocks and figures, what "Insert image" offers (the host's project
// files, uploads), inserting image blocks (toolbar, file drops), the image file in place of the code, and the tools
// on an image box (resize, alt text, caption), which edit the call's source minimally. Entry of
// extensions/images/visual-view/. See ARCHITECTURE.md, "VisualView".
import { Node } from '@tiptap/core';
import { Disposable } from '../../../core/disposable/disposable';
import type { DocumentLinkProvider } from '../../../core/document-links/document-links';
import type { Event } from '../../../core/event-emitter/event-emitter';
import { PathReference } from '../../../core/paths/paths';
import { FieldPopover } from '../../../ui/field-popover/field-popover';
import {
  parenthesized, svg, type Action, type BoxRenderer, type ToolbarContext, type TypstNodeSpec, type VisualViewContext, type VisualViewContribution,
} from '../../../hosts/visual-view/visual-view';
import { Figure, FigureCaption, printFigure, projectFigure } from './figures';
import { type ImageAssets, ImageChoices } from './image-choices';
import { imageFileDrops, insertImages } from './image-insertion';
import { imagePathLink } from './image-path-link';
import { imagePath } from './image-syntax';
import { ImageTools } from './image-tools';

export type { ImageAssets } from './image-choices';

/** Where image files are shown from: the host's project files, as URLs. */
export interface ImageUrls {
  /** A URL of the image file `path` (as written in `#image(..)`), or null if there is none. */
  imageUrl(path: PathReference): string | null;
  /** Fires whenever images may have changed. */
  readonly onDidChange: Event<void>;
}

export interface ImagesOptions {
  /** What "Insert image" offers in a document: the project's images and uploads (default: it only asks for a path). */
  assets?(document: VisualViewContext['document']): ImageAssets | undefined;
  /** Image files shown in place of the call while it is not edited (default: the code). */
  imageUrls?(document: VisualViewContext['document']): ImageUrls | undefined;
  /** Where the file paths in a document lead: an image box's path opens its file, or shows it is missing (default: the text). */
  documentLinks?(document: VisualViewContext['document']): DocumentLinkProvider | undefined;
}

/**
 * `#image("literal path", ..)` blocks, edited as code in a box headed "Image:
 * path", with tools (resize handles, caption, width, alt text) and the image
 * file in place of the code; figures of an image or a table, their caption
 * as rich text; "Insert image" (a path, or the project's images and uploads),
 * and image files dropped on or pasted into the text.
 */
export function images(options: ImagesOptions = {}): VisualViewContribution {
  return {
    id: 'images',
    activate({ visualView, subscriptions }) {
      subscriptions.push(
        visualView.registerNode(imageSpec(options)),
        visualView.registerNode(FIGURE),
        visualView.registerNode(FIGURE_CAPTION),
        visualView.registerToolbarItem({ group: 'insert', order: 10, create: (toolbar) => insertImage(toolbar, options.assets?.(toolbar.document)) }),
        visualView.registerBoxRenderer((view) => imageRenderer(options.imageUrls?.(view.document))),
      );
    },
  };
}

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

function imageSpec(options: ImagesOptions): TypstNodeSpec {
  return {
    name: 'image',
    extension: Image,
    labelled: true,
    box: 'code',
    codeBox: {
      tools: (host, node) => {
        const links = options.documentLinks?.(host.view.document);
        return new ImageTools({ ...host, pathLabel: links && ((path) => imagePathLink(links, path, host.dom.ownerDocument)) }, node);
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

const FIGURE: TypstNodeSpec = {
  name: 'figure',
  extension: Figure,
  anchors: ['layout'],
  labelled: true,
  blockCalls: { figure: projectFigure },
  print: printFigure,
};

const FIGURE_CAPTION: TypstNodeSpec = { name: 'figureCaption', extension: FigureCaption };

/** Image boxes show their file (following path edits at once). */
function imageRenderer(urls: ImageUrls | undefined): BoxRenderer | null {
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

/**
 * "Insert image" and its popover: a path field, plus the project's images
 * and an upload with `assets`. With them, image files dropped on or pasted
 * into the text are uploaded and inserted too (refusals open the popover),
 * and an image dragged from the file panel is inserted where it is dropped.
 */
function insertImage(toolbar: ToolbarContext, assets: ImageAssets | undefined): Action {
  const { editor, root } = toolbar;
  const trigger = () => root.querySelector<HTMLButtonElement>('button[aria-label="Insert"]')!;
  const choices = assets
    ? new ImageChoices(root.ownerDocument, assets, (paths, near) => {
        popover.close();
        insertImages(editor, paths, near);
      })
    : null;
  const popover = new FieldPopover(root, {
    label: 'Image',
    field: 'Image path',
    placeholder: 'images/figure.png',
    apply: (path) => insertImages(editor, [PathReference.of(path)]),
    extra: choices?.element,
  });
  toolbar.subscriptions.push(new Disposable(() => popover.destroy()));
  if (choices) {
    const drops = imageFileDrops(
      async (files, near) => {
        const added = await choices.upload(files, near);
        if (!added && !popover.isOpen) popover.open(trigger(), '', false);
      },
      (path, near) => {
        const reference = assets!.reference(path);
        if (reference !== null) insertImages(editor, [reference], near);
        return reference !== null;
      },
    );
    editor.registerPlugin(drops);
    toolbar.subscriptions.push(new Disposable(() => editor.unregisterPlugin(drops.spec.key!)));
  }
  return {
    label: 'Insert image',
    icon: ICON,
    run: (c) => c.insertContent({ type: 'image' }),
    click: () => {
      choices?.refresh();
      if (popover.isOpen) popover.close();
      else popover.open(trigger(), '', false);
    },
  };
}
