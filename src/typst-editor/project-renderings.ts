import type { TypstDocument } from '../core/typst-document/typst-document';
import type { Preview } from '../features/preview/preview';
import type { VisualViewOptions } from '../features/visual-view/visual-view';
import type { FileContent } from '../core/project/project';
import { extensionOf, fileKind, imageBlob, referencePath, resolvePath } from '../core/project/project';
import type { FileChange, Project } from '../core/project/project';
import { uploadChanges } from '../features/files/files';

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

  private async upload(upload: File, file: string | undefined): Promise<{ path: string } | { error: string }> {
    if (!file) return { error: 'This document is no longer part of the project.' };
    const [change] = await uploadChanges([upload]);
    if (change.kind !== 'create' || fileKind(change.path) !== 'image') {
      return { error: `${upload.name} is not an image the document can show (PNG, JPEG, GIF, SVG or WebP).` };
    }
    const target = this.placeFor(change.path, change.content);
    if (this.options.project.has(target)) return { path: referencePath(file, target) };
    const problem = await this.options.request({ ...change, path: target });
    return problem === null ? { path: referencePath(file, target) } : { error: problem };
  }

  /**
   * Where an upload of `content` named `path` goes: a file with the same
   * content (`name.png`, `name-2.png`, …), else the first free one of those
   * names (browsers name every pasted screenshot `image.png`).
   */
  private placeFor(path: string, content: FileContent): string {
    const extension = extensionOf(path);
    const stem = path.slice(0, path.length - extension.length);
    for (let n = 1; ; n++) {
      const candidate = n === 1 ? path : `${stem}-${n}${extension}`;
      const existing = this.options.project.content(candidate);
      if (existing === undefined || sameContent(existing, content)) return candidate;
    }
  }
}

function sameContent(a: FileContent, b: FileContent): boolean {
  if (typeof a === 'string' || typeof b === 'string') return a === b;
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}
