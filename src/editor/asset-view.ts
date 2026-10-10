import type { FileContent } from '../preview/project-files';
import { displayName, fileKind, imageBlob } from '../core/project/paths';

/**
 * The read-only view of a project file that is not Typst source: an image
 * preview with an "Insert into …" button, the text of a data file, or just
 * its size.
 */
export class AssetView {
  private readonly root: HTMLElement;
  private objectUrl: string | null = null;

  constructor(
    parent: HTMLElement,
    private readonly onInsert: (path: string) => void,
  ) {
    this.root = parent.ownerDocument.createElement('div');
    this.root.className = 'typst-asset';
    this.root.dataset.testid = 'typst-asset';
    this.root.hidden = true;
    parent.append(this.root);
  }

  /** Shows `path`; `insertInto` names the file an image would be inserted into (null: no button). */
  show(path: string, content: FileContent, insertInto: string | null): void {
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
    if (insertInto !== null && fileKind(path) === 'image') this.root.append(this.insertButton(path, insertInto));
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

  private insertButton(path: string, insertInto: string): HTMLButtonElement {
    const button = this.root.ownerDocument.createElement('button');
    button.type = 'button';
    button.className = 'typst-asset__insert';
    button.textContent = `Insert into ${displayName(insertInto)}`;
    button.addEventListener('click', () => this.onInsert(path));
    return button;
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
