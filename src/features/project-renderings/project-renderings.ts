// ProjectRenderings: what a document's Visual view renders and inserts (snippets, image URLs, uploads).
// Kept as one unit for now; the slices wave splits it into the `images` extension (image URLs, uploads)
// and `rendered-boxes` (snippets). See ARCHITECTURE.md, "createTypstEditor".
import { Disposable } from '../../core/disposable/disposable';
import type { TypstDocument } from '../../core/typst-document/typst-document';
import type { TypstExtension } from '../../hosts/workbench/workbench';
import type { PreviewContributions } from '../../hosts/preview/preview';
import type { VisualViewOptions } from '../visual-view/visual-view';
import { type FileChange, type FileContent, type Project } from '../../core/project/project';
import { type PathReference, ProjectPath } from '../../core/paths/paths';
import { uploadChanges } from '../files/files';

/**
 * What every document's Visual view renders and inserts: compiled snippets from the preview, the project's image
 * files, and the images "Insert image" offers or uploads (uploads go through `Workbench.applyChange`).
 */
export function projectRenderings(): TypstExtension {
  return {
    id: 'project-renderings',
    activate({ project, workbench, preview, visualView, subscriptions }) {
      const renderings = new ProjectRenderings({ project, preview, request: (change) => workbench.applyChange(change) });
      subscriptions.push(
        new Disposable(() => renderings.destroy()),
        visualView.registerDocumentOptions((document) => renderings.forDocument(document)),
      );
    },
  };
}

export interface ProjectRenderingsOptions {
  project: Project;
  preview: Pick<PreviewContributions, 'snippet' | 'onDidRender'>;
  /** Applies a change (an uploaded image) if allowed; resolves to the reason it was not, or null. */
  request(change: FileChange): Promise<string | null>;
}

/**
 * What the Visual view of a project document shows and inserts: compiled
 * snippets cut from the preview's pages, the project's image files (as object
 * URLs, made once per file content and revoked when replaced or on destroy),
 * and the images "Insert image" offers or uploads, with paths as written in
 * that document.
 */
export class ProjectRenderings {
  private readonly urls = new Map<ProjectPath, { content: unknown; url: string }>();

  constructor(private readonly options: ProjectRenderingsOptions) {}

  /** The Visual view options for `document` (it may be renamed later; paths follow). */
  forDocument(document: TypstDocument): VisualViewOptions {
    const { project, preview } = this.options;
    const path = () => project.pathOf(document);
    return {
      renderer: {
        snippet: async (from, to, text) => {
          const file = path();
          return file ? preview.snippet(file, from, to, text) : null;
        },
        imageUrl: (reference) => {
          const file = path();
          const target = file && ProjectPath.resolve(file, reference);
          return target ? this.imageUrl(target) : null;
        },
        onChange: (listener) => {
          const subscription = preview.onDidRender(listener);
          return () => subscription.dispose();
        },
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
    const [change] = await uploadChanges([upload]);
    if (!change || change.kind !== 'create' || ProjectPath.kind(change.path) !== 'image') {
      return { error: `${upload.name} is not an image the document can show (PNG, JPEG, GIF, SVG or WebP).` };
    }
    const target = this.placeFor(change.path, change.content);
    if (this.options.project.has(target)) return { path: ProjectPath.referenceTo(file, target) };
    const problem = await this.options.request({ ...change, path: target });
    return problem === null ? { path: ProjectPath.referenceTo(file, target) } : { error: problem };
  }

  /**
   * Where an upload of `content` named `path` goes: a file with the same
   * content (`name.png`, `name-2.png`, …), else the first free one of those
   * names (browsers name every pasted screenshot `image.png`).
   */
  private placeFor(path: ProjectPath, content: FileContent): ProjectPath {
    const extension = ProjectPath.extension(path);
    const stem = path.slice(0, path.length - extension.length);
    for (let n = 1; ; n++) {
      const candidate = n === 1 ? path : ProjectPath.of(`${stem}-${n}${extension}`);
      const existing = this.options.project.content(candidate);
      if (existing === undefined || sameContent(existing, content)) return candidate;
    }
  }
}

function sameContent(a: FileContent, b: FileContent): boolean {
  if (typeof a === 'string' || typeof b === 'string') return a === b;
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}
