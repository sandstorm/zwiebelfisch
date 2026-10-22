import type { Event } from '../../core/event-emitter/event-emitter';
import { type PathReference, ProjectPath } from '../../core/paths/paths';
import type { FileChange, FileContent, Project } from '../../core/project/project';
import type { TypstDocument } from '../../core/typst-document/typst-document';
import { uploadChanges, uploadTarget } from '../../core/uploads/uploads';
import type { DocumentDropEditProvider } from '../../hosts/languages/languages';
import type { Extension } from '../../hosts/extension-host/extension-host';
import css from './images.css?inline';
import { IMAGE_FILES, imageBlob, isImage, uploadFolder } from './model/image-files';
import { imageSource } from './visual-editor/image-syntax';
import { registerImages, type ImageAssets, type ImageUrls } from './visual-editor/visual-editor';
import { imageEditor } from './window/image-editor';

/**
 * Images, from the file in the project to the box in the text.
 * - in the Visual editor, an `#image("path", ..)` block (also a figure's body) shows the image file in place of its
 *   code, with tools to resize it and set its caption
 * - "Insert image" offers the project's images and uploads
 * - image files pasted or dropped into the text become `#image("path")` there; files from the computer are uploaded
 *   first
 * - image files open read-only in the editing area (`images.editor`)
 *
 * An edit on an image box rewrites only the argument it touches.
 */
export function images(): Extension {
  return {
    id: 'images',
    activate(context) {
      const { project, workspace, window, languages, preview, subscriptions } = context;
      const projectImages = new ProjectImages({ project, onDidChange: preview.onDidRender, applyEdit: (change) => workspace.applyEdit(change) });
      subscriptions.push(
        window.registerStyleSheet(css),
        projectImages,
        window.registerEditorProvider('images.editor', imageEditor, { filenamePattern: IMAGE_FILES, displayName: 'Image', icon: IMAGE_ICON }),
        languages.registerDocumentDropEditProvider({ language: 'typst' }, imageDrops(project)),
        registerImages(context, {
          assets: (document) => projectImages.forDocument(document).assets,
          imageUrls: (document) => projectImages.forDocument(document).urls,
          prompts: window,
        }),
      );
    },
  };
}

/**
 * An image file dropped into a Typst file: `#image("path")`, the path written from that file. One from the computer
 * goes where the project's images are (`uploadFolder`), as pasted ones do.
 */
function imageDrops(project: Project): DocumentDropEditProvider {
  return {
    provideDocumentDropEdits: (document, _position, file) => (isImage(file) ? { insertText: imageSource(ProjectPath.referenceTo(document.path, file)) } : null),
    provideUploadFolder: (_document, file) => (isImage(file) ? uploadFolder(project.paths().filter((p) => isImage(p))) : undefined),
  };
}

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
    const { content } = change;
    const folder = uploadFolder(project.paths().filter((p) => isImage(p)));
    const target = uploadTarget(ProjectPath.of(folder + ProjectPath.name(change.path)), content, (candidate) => project.content(candidate));
    if (project.has(target)) return { path: ProjectPath.referenceTo(file, target) };
    const problem = await applyEdit({ kind: 'create', path: target, content });
    return problem === null ? { path: ProjectPath.referenceTo(file, target) } : { error: problem };
  }
}

/** The icon of image files (where side panels list files). */
const IMAGE_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="12" height="10" rx="1.5"/><circle cx="6" cy="6.5" r="1.2"/><path d="m2.5 12 3.5-3.5 2.5 2.5 2-2 3 3"/></svg>';
