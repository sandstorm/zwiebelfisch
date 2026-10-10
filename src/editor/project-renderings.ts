import type { TypstDocument } from '../document/typst-document';
import type { Preview } from '../preview/preview';
import type { VisualViewOptions } from '../visual-view/visual-view';
import { fileKind, imageBlob, referencePath, resolvePath } from './paths';
import type { FileChange, Project } from './project';
import { uploadChanges } from './upload';

export interface ProjectRenderingsOptions {
  project: Project;
  preview: Pick<Preview, 'snippet' | 'onRender'>;
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
  private readonly urls = new Map<string, { content: unknown; url: string }>();

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
          const target = file && resolvePath(file, reference);
          return target ? this.imageUrl(target) : null;
        },
        onChange: (listener) => preview.onRender(listener),
      },
      assets: {
        list: () => {
          const file = path();
          return file ? project.paths().filter((p) => fileKind(p) === 'image').map((p) => referencePath(file, p)) : [];
        },
        upload: (upload) => this.upload(upload, path()),
      },
    };
  }

  destroy(): void {
    for (const { url } of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
  }

  private imageUrl(path: string): string | null {
    const content = fileKind(path) === 'image' ? this.options.project.content(path) : undefined;
    const cached = this.urls.get(path);
    if (cached?.content === content) return cached?.url ?? null;
    if (cached) URL.revokeObjectURL(cached.url);
    this.urls.delete(path);
    if (content === undefined) return null;
    const url = URL.createObjectURL(imageBlob(path, content));
    this.urls.set(path, { content, url });
    return url;
  }

  private async upload(upload: File, file: string | undefined): Promise<string | null> {
    if (!file) return null;
    const [change] = await uploadChanges([upload]);
    if (change.kind !== 'create' || fileKind(change.path) !== 'image') return null;
    const problem = await this.options.request(change);
    return problem === null ? referencePath(file, change.path) : null;
  }
}
