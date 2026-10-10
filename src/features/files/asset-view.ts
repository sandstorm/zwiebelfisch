// AssetView: the read-only view of a non-Typst file (image or data). See files.ts.
import { type FileContent } from '../../core/project/project';
import { displayName, fileKind, imageBlob } from '../../core/paths/paths';

/**
 * The read-only view of a project file that is not Typst source: an image
 * preview, the text of a data file, or just its size. (Images get into the
 * text by dragging them from the file panel, or with "Insert image".)
 */
export class AssetView {
  private readonly root: HTMLElement;
  private objectUrl: string | null = null;

  constructor(parent: HTMLElement) {
    this.root = parent.ownerDocument.createElement('div');
    this.root.className = 'typst-asset';
    this.root.dataset.testid = 'typst-asset';
    this.root.hidden = true;
    parent.append(this.root);
  }

  /** Shows `path`. */
  show(path: string, content: FileContent): void {
    this.release();
    const doc = this.root.ownerDocument;
    const title = doc.createElement('h2');
    title.className = 'typst-asset__title';
    title.textContent = displayName(path);
    const size = doc.createElement('span');
    size.className = 'typst-asset__size';
    size.textContent = formatSize(typeof content === 'string' ? new TextEncoder().encode(content).length : content.length);
    title.append(size);
    this.root.replaceChildren(title, this.body(path, content));
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
    this.release();
    this.root.replaceChildren();
  }

  destroy(): void {
    this.release();
    this.root.remove();
  }

  private body(path: string, content: FileContent): HTMLElement {
    const doc = this.root.ownerDocument;
    if (fileKind(path) === 'image') {
      const image = doc.createElement('img');
      image.className = 'typst-asset__image';
      image.alt = displayName(path);
      this.objectUrl = URL.createObjectURL(imageBlob(path, content));
      image.src = this.objectUrl;
      return image;
    }
    if (typeof content === 'string') {
      const text = doc.createElement('pre');
      text.className = 'typst-asset__text';
      text.textContent = content;
      return text;
    }
    const note = doc.createElement('p');
    note.className = 'typst-asset__note';
    note.textContent = 'This file is used by the document but cannot be shown here.';
    return note;
  }

  private release(): void {
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
  }
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
