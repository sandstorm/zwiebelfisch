import type { Event } from '../../core/event-emitter/event-emitter';
import { type PathReference, ProjectPath } from '../../core/paths/paths';
import type { FileChange, FileContent, Project } from '../../core/project/project';
import type { TypstDocument } from '../../core/typst-document/typst-document';
import { uploadChanges } from '../../core/uploads/uploads';
import type { DocumentDropEditProvider } from '../../hosts/languages/languages';
import type { TypstExtension } from '../../hosts/workbench/workbench';
import css from './images.css?inline';
import { IMAGE_FILES, imageBlob, isImage } from './model/image-files';
import { uploadTarget } from './model/upload';
import { imageSource } from './visual-editor/image-syntax';
import { imagesVisualEditor, type ImageAssets, type ImageUrls } from './visual-editor/visual-editor';
import { imageEditor } from './workbench/image-editor';

/**
 * Images, from the file in the project to the box in the text. In the Visual editor an `#image("path", ..)` block
 * (also a figure's body) is a box that shows the project's image file in place of its code, with tools to resize it,
 * set its alt text and add a caption (ImageTools in visual-editor/image-tools.ts). "Insert image" offers the project's
 * images and uploads; image files dropped on or pasted into the text are uploaded and inserted too, and an image
 * dragged from the file panel becomes `#image("path")` where it is dropped (a drop edit provider). Uploads go through
 * `workspace.applyEdit`. Image files open read-only in the editing area (the custom editor `images.editor`).
 *
 * An image is one concept, so it is one extension: the Visual editor knows only raw boxes, their renderers and tools,
 * the window only custom editors, and the file panel only files. The path on an image box is the document link the
 * link providers (`languages`) put on it, so it opens the file or says it is missing. An edit on an image box rewrites
 * only the argument it touches (model/image-call.ts). See docs/30_architecture/08_built-in-extensions.typ.
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
        window.registerCustomEditorProvider('images.editor', imageEditor, { filenamePattern: IMAGE_FILES, displayName: 'Image', icon: IMAGE_ICON }),
        languages.registerDocumentDropEditProvider({ language: 'typst' }, imageDrops),
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

/** An image file dropped into a Typst file: `#image("path")`, the path written from that file. */
const imageDrops: DocumentDropEditProvider = {
  provideDocumentDropEdits: (document, _position, file) => (isImage(file) ? { insertText: imageSource(ProjectPath.referenceTo(document.path, file)) } : null),
};

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

/** The icon of image files (where side panels list files). */
const IMAGE_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="12" height="10" rx="1.5"/><circle cx="6" cy="6.5" r="1.2"/><path d="m2.5 12 3.5-3.5 2.5 2.5 2-2 3 3"/></svg>';
