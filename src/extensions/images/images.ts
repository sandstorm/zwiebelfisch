// The images extension: `#image(..)` blocks (also as figures' bodies) in the Visual editor showing the project's image files,
// "Insert image" with the project's images and uploads, and image files opened read-only in the editing area. Entry of extensions/images/. See docs/30_architecture/08_built-in-extensions.typ.
// Why one extension: an image is one concept from the file in the project to the box in the text; the Visual
// view's host only knows boxes, renderers and custom editors, and the file panel only knows files.
import type { Event } from '../../core/event-emitter/event-emitter';
import { type PathReference, ProjectPath } from '../../core/paths/paths';
import type { FileChange, FileContent, Project } from '../../core/project/project';
import type { TypstDocument } from '../../core/typst-document/typst-document';
import { uploadChanges } from '../../core/uploads/uploads';
import type { TypstExtension } from '../../hosts/workbench/workbench';
import css from './images.css?inline';
import { IMAGE_FILES, imageBlob, isImage } from './model/image-files';
import { uploadTarget } from './model/upload';
import { imagesVisualEditor, type ImageAssets, type ImageUrls } from './visual-editor/visual-editor';
import { assetEditor } from './workbench/asset-view';

/**
 * Images in every document's Visual editor (`#image(..)` boxes showing the project's image file, "Insert image"
 * offering the project's images and uploads, which go through `workspace.applyEdit`; an image box's path is the
 * document link on it, from the link providers (`languages`)), and the read-only view of image files: the custom
 * editor `images.preview` (`*.{png,jpg,jpeg,gif,svg,webp}`).
 */
export function images(): TypstExtension {
  return {
    id: 'images',
    activate(context) {
      const { project, workspace, window, languages, workbench, preview, subscriptions } = context;
      const projectImages = new ProjectImages({ project, onDidChange: preview.onDidRender, applyEdit: (change) => workspace.applyEdit(change) });
      subscriptions.push(
        workbench.registerStyleSheet(css),
        projectImages,
        window.registerCustomEditorProvider('images.preview', assetEditor, { filenamePattern: IMAGE_FILES, displayName: 'Image', icon: IMAGE_ICON }),
      );
      imagesVisualEditor({
        assets: (document) => projectImages.forDocument(document).assets,
        imageUrls: (document) => projectImages.forDocument(document).urls,
        imageLinks: (document) => ({
          linkOf: (src) => {
            const file = project.pathOf(document);
            // the providers read Typst markup; a figure's body is written in code (`image(..)`, no `#`)
            const markup = src.startsWith('#') ? src : `#${src}`;
            const [link] = file ? languages.provideDocumentLinks({ path: file, languageId: 'typst', text: markup }) : [];
            return link ? languages.resolveDocumentLink(link) : null;
          },
          open: (target) => workbench.open(target),
        }),
        prompts: window,
      }).activate(context);
    },
  };
}

/** The icon of image files (where views list files). */
const IMAGE_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="12" height="10" rx="1.5"/><circle cx="6" cy="6.5" r="1.2"/><path d="m2.5 12 3.5-3.5 2.5 2.5 2-2 3 3"/></svg>';

export interface ProjectImagesOptions {
  project: Project;
  /** Fires whenever image files may have changed (a new compile). */
  onDidChange: Event<void>;
  /** Applies a change (an uploaded image) if allowed; resolves to the reason it was not, or null (`workspace.applyEdit`). */
  applyEdit(change: FileChange): Promise<string | null>;
}

/**
 * The project's image files as a document's Visual editor shows and inserts
 * them: as object URLs (made once per file content and revoked when replaced
 * or on dispose), and as the images "Insert image" offers or uploads, with
 * paths as written in that document.
 */
export class ProjectImages {
  private readonly urls = new Map<ProjectPath, { content: FileContent; url: string }>();

  constructor(private readonly options: ProjectImagesOptions) {}

  /** The images of `document`'s Visual editor (it may be renamed later; paths follow). */
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

  dispose(): void {
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
    const { project, applyEdit } = this.options;
    const { path, content } = change;
    const target = uploadTarget(path, content, (candidate) => project.content(candidate));
    if (project.has(target)) return { path: ProjectPath.referenceTo(file, target) };
    const problem = await applyEdit({ kind: 'create', path: target, content });
    return problem === null ? { path: ProjectPath.referenceTo(file, target) } : { error: problem };
  }
}
