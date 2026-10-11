// The images extension: `#image(..)` blocks (also as figures' bodies) in the Visual view showing the project's image files,
// "Insert image" with the project's images and uploads, and images / data files opened read-only in the editing
// area. Entry of extensions/images/. See ARCHITECTURE.md, "createTypstEditor".
// Why one extension: an image is one concept from the file in the project to the box in the text; the Visual
// view's host only knows boxes, renderers and custom editors, and the file panel only knows files.
import { Disposable } from '../../core/disposable/disposable';
import type { Event } from '../../core/event-emitter/event-emitter';
import { type PathReference, ProjectPath } from '../../core/paths/paths';
import type { FileChange, FileContent, Project } from '../../core/project/project';
import type { TypstDocument } from '../../core/typst-document/typst-document';
import { uploadChanges } from '../../core/uploads/uploads';
import type { VisualViewContribution } from '../../hosts/visual-view/visual-view';
import type { DocumentLink, TypstExtension, Workbench } from '../../hosts/workbench/workbench';
import css from './images.css?inline';
import { IMAGE_FILES, imageBlob, isImage } from './model/image-files';
import { uploadTarget } from './model/upload';
import { imageRenderer, imageSpec, insertImage } from './visual-view/visual-view';
import { assetEditor } from './workbench/workbench';

/**
 * Images in every document's Visual view (`#image(..)` boxes showing the project's image file, "Insert image"
 * offering the project's images and uploads, which go through `Workbench.applyChange`; an image box's path is the
 * document link on it, from the workbench's link providers), and the read-only view of image and other files: the
 * custom editors `images.preview` (`*.{png,jpg,jpeg,gif,svg,webp}`) and `images.file` (`*`, any other file).
 */
export function images(): TypstExtension {
  return {
    id: 'images',
    activate(context) {
      const { project, workbench, preview, subscriptions } = context;
      const projectImages = new ProjectImages({ project, onDidChange: preview.onDidRender, applyChange: (change) => workbench.applyChange(change) });
      subscriptions.push(
        workbench.registerStyleSheet(css),
        new Disposable(() => projectImages.destroy()),
        workbench.registerCustomEditorProvider('images.preview', assetEditor, { filenamePattern: IMAGE_FILES }),
        // any other file (`*` is the least specific pattern: every other editor's wins)
        workbench.registerCustomEditorProvider('images.file', assetEditor, { filenamePattern: '*' }),
      );
      imagesVisualView({
        assets: (document) => projectImages.forDocument(document).assets,
        imageUrls: (document) => projectImages.forDocument(document).urls,
        imageLinks: (document) => ({
          linkOf: (src) => {
            const file = project.pathOf(document);
            const [link] = file ? workbench.provideDocumentLinks({ path: file, text: src }) : [];
            return link ? workbench.resolveDocumentLink(link) : null;
          },
          open: (target) => workbench.open(target),
        }),
        prompts: workbench,
      }).activate(context);
    },
  };
}

/**
 * `#image("literal path", ..)` blocks, edited as code in a box headed "Image:
 * path", with tools (resize handles, width, alt text; a caption where the
 * figures extension offers one) and the image file in place of the code, also
 * as a figure's body; "Insert image" (a path, or the project's images and
 * uploads), and image files dropped on or pasted into the text.
 */
export function imagesVisualView(options: ImagesOptions = {}): VisualViewContribution {
  return {
    id: 'images',
    activate({ visualView, subscriptions }) {
      subscriptions.push(
        visualView.registerNode(imageSpec(options)),
        visualView.registerToolbarItem({ group: 'insert', order: 10, create: (toolbar) => insertImage(toolbar, options.assets?.(toolbar.document), options.prompts) }),
        // image boxes are raw boxes, too: drawn as their image file rather than as a compiled snippet (priority 100)
        visualView.registerBoxRenderer((view) => imageRenderer(options.imageUrls?.(view.document)), { priority: 110 }),
      );
    },
  };
}

/** Where images ask (an image, a path, alt text) and tell why an upload was refused: the workbench's. */
export type ImagePrompts = Pick<Workbench, 'showQuickPick' | 'showInputBox' | 'showErrorMessage'>;

/** Where image files are shown from: the host's project files, as URLs. */
export interface ImageUrls {
  /** A URL of the image file `path` (as written in `#image(..)`), or null if there is none. */
  imageUrl(path: PathReference): string | null;
  /** Fires whenever images may have changed. */
  readonly onDidChange: Event<void>;
}

export interface ImagesOptions {
  /** What "Insert image" offers in a document: the project's images and uploads (default: it only asks for a path). */
  assets?(document: TypstDocument): ImageAssets | undefined;
  /** Image files shown in place of the call while it is not edited (default: the code). */
  imageUrls?(document: TypstDocument): ImageUrls | undefined;
  /** The links on image paths in a document: an image box's path opens its file, or shows it is missing (default: the text). */
  imageLinks?(document: TypstDocument): ImageLinks | undefined;
  /** Where "Insert image" and "Alt text" ask, and refused uploads are told (default: they do nothing). */
  prompts?: ImagePrompts;
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

export interface ProjectImagesOptions {
  project: Project;
  /** Fires whenever image files may have changed (a new compile). */
  onDidChange: Event<void>;
  /** Applies a change (an uploaded image) if allowed; resolves to the reason it was not, or null (`Workbench.applyChange`). */
  applyChange(change: FileChange): Promise<string | null>;
}

/**
 * The project's image files as a document's Visual view shows and inserts
 * them: as object URLs (made once per file content and revoked when replaced
 * or on destroy), and as the images "Insert image" offers or uploads, with
 * paths as written in that document.
 */
export class ProjectImages {
  private readonly urls = new Map<ProjectPath, { content: FileContent; url: string }>();

  constructor(private readonly options: ProjectImagesOptions) {}

  /** The images of `document`'s Visual view (it may be renamed later; paths follow). */
  forDocument(document: TypstDocument): { urls: ImageUrls; assets: ImageAssets } {
    const { project, onDidChange } = this.options;
    const path = () => project.pathOf(document);
    return {
      urls: {
        imageUrl: (reference) => {
          const file = path();
          const target = file && ProjectPath.resolve(file, reference);
          return target ? this.imageUrl(target) : null;
        },
        onDidChange,
      },
      assets: {
        list: () => {
          const file = path();
          return file ? project.paths().filter((p) => isImage(p)).map((p) => ProjectPath.referenceTo(file, p)) : [];
        },
        upload: (upload) => this.upload(upload, path()),
        reference: (image) => {
          const file = path();
          return file && isImage(image) && project.has(image) ? ProjectPath.referenceTo(file, image) : null;
        },
      },
    };
  }

  destroy(): void {
    for (const { url } of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
  }

  private imageUrl(path: ProjectPath): string | null {
    const content = isImage(path) ? this.options.project.content(path) : undefined;
    const cached = this.urls.get(path);
    if (cached?.content === content) return cached?.url ?? null;
    if (cached) URL.revokeObjectURL(cached.url);
    this.urls.delete(path);
    if (content === undefined) return null;
    const url = URL.createObjectURL(imageBlob(path, content));
    this.urls.set(path, { content, url });
    return url;
  }

  private async upload(upload: File, file: ProjectPath | undefined): Promise<{ path: PathReference } | { error: string }> {
    if (!file) return { error: 'This document is no longer part of the project.' };
    const [change] = await uploadChanges([upload]);
    if (change?.kind !== 'create' || !isImage(change.path)) {
      return { error: `${upload.name} is not an image the document can show (PNG, JPEG, GIF, SVG or WebP).` };
    }
    const { project, applyChange } = this.options;
    const { path, content } = change;
    const target = uploadTarget(path, content, (candidate) => project.content(candidate));
    if (project.has(target)) return { path: ProjectPath.referenceTo(file, target) };
    const problem = await applyChange({ kind: 'create', path: target, content });
    return problem === null ? { path: ProjectPath.referenceTo(file, target) } : { error: problem };
  }
}
