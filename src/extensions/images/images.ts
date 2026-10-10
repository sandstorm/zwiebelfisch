// The images extension: `#image(..)` blocks and figures in the Visual view showing the project's image files,
// "Insert image" with the project's images and uploads, and images / data files opened read-only in the editing
// area. Entry of extensions/images/. See ARCHITECTURE.md, "createTypstEditor".
// Why one extension: an image is one concept from the file in the project to the box in the text; the Visual
// view's host only knows boxes, renderers and file views, and the file panel only knows files.
import { Disposable } from '../../core/disposable/disposable';
import type { Event } from '../../core/event-emitter/event-emitter';
import type { TypstDocument } from '../../core/typst-document/typst-document';
import type { TypstExtension } from '../../hosts/workbench/workbench';
import { type FileChange, type Project } from '../../core/project/project';
import { type PathReference, ProjectPath } from '../../core/paths/paths';
import { uploadPath, uploadTarget } from './model/model';
import { imagesVisualView, type ImageAssets, type ImageUrls } from './visual-view/visual-view';
import { assetViews } from './workbench/workbench';

export { imagesVisualView, type ImageAssets, type ImageUrls } from './visual-view/visual-view';

/**
 * Images in every document's Visual view (`#image(..)` boxes showing the project's image file, "Insert image"
 * offering the project's images and uploads, which go through `Workbench.applyChange`; an image box's path opens
 * the file, with the `documentLinks` service), and the read-only view of image and data files.
 */
export function images(): TypstExtension {
  return {
    id: 'images',
    activate(context) {
      const { project, workbench, preview, services, subscriptions } = context;
      const projectImages = new ProjectImages({ project, onDidChange: preview.onDidRender, request: (change) => workbench.applyChange(change) });
      subscriptions.push(
        new Disposable(() => projectImages.destroy()),
        workbench.registerFileView('image', assetViews),
        workbench.registerFileView('data', assetViews),
      );
      const documentLinks = services.get('documentLinks');
      imagesVisualView({
        assets: (document) => projectImages.forDocument(document).assets,
        imageUrls: (document) => projectImages.forDocument(document).urls,
        documentLinks,
      }).activate(context);
    },
  };
}

export interface ProjectImagesOptions {
  project: Project;
  /** Fires whenever image files may have changed (a new compile). */
  onDidChange: Event<void>;
  /** Applies a change (an uploaded image) if allowed; resolves to the reason it was not, or null. */
  request(change: FileChange): Promise<string | null>;
}

/**
 * The project's image files as a document's Visual view shows and inserts
 * them: as object URLs (made once per file content and revoked when replaced
 * or on destroy), and as the images "Insert image" offers or uploads, with
 * paths as written in that document.
 */
export class ProjectImages {
  private readonly urls = new Map<ProjectPath, { content: unknown; url: string }>();

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
          return file ? project.paths().filter((p) => ProjectPath.kind(p) === 'image').map((p) => ProjectPath.referenceTo(file, p)) : [];
        },
        upload: (upload) => this.upload(upload, path()),
        reference: (image) => {
          const file = path();
          return file && ProjectPath.kind(image) === 'image' && project.has(image) ? ProjectPath.referenceTo(file, image) : null;
        },
      },
    };
  }

  destroy(): void {
    for (const { url } of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
  }

  private imageUrl(path: ProjectPath): string | null {
    const content = ProjectPath.kind(path) === 'image' ? this.options.project.content(path) : undefined;
    const cached = this.urls.get(path);
    if (cached?.content === content) return cached?.url ?? null;
    if (cached) URL.revokeObjectURL(cached.url);
    this.urls.delete(path);
    if (content === undefined) return null;
    const url = URL.createObjectURL(ProjectPath.imageBlob(path, content));
    this.urls.set(path, { content, url });
    return url;
  }

  private async upload(upload: File, file: ProjectPath | undefined): Promise<{ path: PathReference } | { error: string }> {
    if (!file) return { error: 'This document is no longer part of the project.' };
    const path = uploadPath(upload.name);
    if (!path || ProjectPath.kind(path) !== 'image') {
      return { error: `${upload.name} is not an image the document can show (PNG, JPEG, GIF, SVG or WebP).` };
    }
    const { project, request } = this.options;
    const content = new Uint8Array(await upload.arrayBuffer());
    const target = uploadTarget(path, content, (candidate) => project.content(candidate));
    if (project.has(target)) return { path: ProjectPath.referenceTo(file, target) };
    const problem = await request({ kind: 'create', path: target, content });
    return problem === null ? { path: ProjectPath.referenceTo(file, target) } : { error: problem };
  }
}
