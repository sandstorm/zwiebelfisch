// AssetView: the read-only view of an image file. See workbench.ts.
import { FileContent } from '../../../core/project/project';
import { ProjectPath } from '../../../core/paths/paths';
import { imageBlob } from '../model/image-files';

/**
 * The read-only view of an image file of the project: its name, size and the
 * picture. (Images get into the text by dragging them from the file panel, or
 * with "Insert image".)
 */
export class AssetView {
  private readonly root: HTMLElement;
  private objectUrl: string | null = null;

  constructor(parent: HTMLElement) {
    this.root = parent.ownerDocument.createElement('div');
    this.root.className = 'typst-asset';
    this.root.dataset.testid = 'typst-asset';
    parent.append(this.root);
  }

  /** Shows image `path`. */
  show(path: ProjectPath, content: FileContent): void {
    this.release();
    const doc = this.root.ownerDocument;
    const title = doc.createElement('h2');
    title.className = 'typst-asset__title';
    title.textContent = ProjectPath.displayName(path);
    const size = doc.createElement('span');
    size.className = 'typst-asset__size';
    size.textContent = formatSize(FileContent.bytes(content).length);
    title.append(size);
    const image = doc.createElement('img');
    image.className = 'typst-asset__image';
    image.alt = ProjectPath.displayName(path);
    this.objectUrl = URL.createObjectURL(imageBlob(path, content));
    image.src = this.objectUrl;
    this.root.replaceChildren(title, image);
  }

  dispose(): void {
    this.release();
    this.root.remove();
  }

  private release(): void {
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
