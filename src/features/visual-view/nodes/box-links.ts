// File links on raw boxes: "Open template.typ" on a box whose code names project files, a clickable path
// in an image box's heading. See raw-box.ts and ARCHITECTURE.md, "File links".
import { describeLink, type FileLinks, findPathReferences } from '../../../core/project/project';
import { linkInfo } from '../../source-view/source-view';

/**
 * The row of file links on a raw block (CSS shows it over the box's corner only on hover or focus): one "Open …" (or "… is not in the
 * project" / "Create …") per distinct path its code names (`#import`,
 * `#include`, `read(..)`, …). Hidden while there is none. Shown again when
 * the pointer enters the box, so a file created meanwhile becomes "Open".
 */
export class BoxLinks {
  readonly element: HTMLElement;
  private src: string | null = null;

  constructor(box: HTMLElement, private readonly links: FileLinks, src: string) {
    this.element = box.ownerDocument.createElement('div');
    this.element.className = 'typst-visual__box-label typst-visual__box-links';
    this.element.hidden = true;
    box.prepend(this.element);
    box.addEventListener('pointerenter', () => this.render());
    this.update(src);
  }

  update(src: string): void {
    if (src === this.src) return;
    this.src = src;
    this.render();
  }

  private render(): void {
    const doc = this.element.ownerDocument;
    const paths = [...new Set(findPathReferences(this.src ?? '').map((r) => r.path))];
    const items = paths.flatMap((path) => linkInfo(doc, this.links, path, { hint: false }) ?? []);
    this.element.replaceChildren(...items);
    this.element.hidden = items.length === 0;
  }
}

/** An image box's path as a button that opens the file, or the path marked as missing. */
export function imagePathLink(doc: Document, links: FileLinks, path: string): Node {
  const target = describeLink(links, path);
  if (!target?.exists) {
    const missing = doc.createElement('span');
    missing.className = 'typst-visual__path typst-visual__path--missing';
    missing.textContent = path;
    missing.title = target ? `${target.name} is not in the project` : 'Outside the project';
    return missing;
  }
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'typst-visual__path';
  button.textContent = path;
  button.title = `Open ${target.name}`;
  button.addEventListener('mousedown', (event) => event.preventDefault());
  button.addEventListener('click', () => links.open(target.path));
  return button;
}
