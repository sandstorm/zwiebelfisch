// ImageTools: resize handles, width presets, alt text and caption on an image box. See images.ts.
import type { PathReference } from '../../../core/paths/paths';
import type { Editor } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { FieldPopover } from '../field-popover';
import { imageWidthCss } from './image-call';
import { addCaption, imageInfo, removeCaption, resizeImage, setImageAlt } from './image-edits';
import { imagePath } from '../projection/projection';

/** The image box the tools belong to. */
export interface ImageToolsHost {
  /** The box's element. */
  dom: HTMLElement;
  /** The element holding the code editor; the tools go in before it. */
  code: HTMLElement;
  /** The rendered picture (moved into the resize frame), or null without a renderer. */
  picture: HTMLImageElement | null;
  editor: Editor;
  /** The box's document position, while it is in the document. */
  getPos(): number | undefined;
  /** Shows and focuses the image call's code. */
  editCode(): void;
  /** The image's path in the heading, e.g. as a link to the file (default: the text). */
  pathLabel?: ((path: PathReference) => globalThis.Node) | null;
}

/** Width presets offered as buttons (keyboard-friendly resizing). */
const PRESETS = [25, 50, 75, 100];
/** Resize handles: corners and sides; `w` in the name means it sits on the left. */
const HANDLES = ['nw', 'ne', 'sw', 'se', 'w', 'e'];

/** Where a resize drag started: the image's width and the text width (px), and whether the image is centered. */
export interface DragStart {
  width: number;
  reference: number;
  centered: boolean;
}

/**
 * The new width in percent of the text width after dragging a handle by `dx`
 * pixels: `direction` is -1 for handles on the left. A centered image grows
 * on both sides, so it changes by twice the drag. Whole percent, 1 to 100.
 */
export function resizedPercent({ width, reference, centered }: DragStart, dx: number, direction: 1 | -1): number {
  if (reference <= 0) return 100;
  const dragged = width + dx * direction * (centered ? 2 : 1);
  return Math.min(100, Math.max(1, Math.round((dragged / reference) * 100)));
}

/**
 * What an image box offers besides its code: the "Image: path" heading, a
 * frame around the rendered picture showing the image's width with drag
 * handles to change it, and, while the image is selected, a small toolbar
 * (add/remove caption, preset widths, alt text, edit the code).
 *
 * Every change is one transaction from `image-edits`, so one undo step that
 * rewrites only the argument concerned. A drag changes the width live in the
 * view and writes `width: NN%` once, on release.
 */
export class ImageTools {
  private readonly label: HTMLElement;
  private readonly frame: HTMLElement | null = null;
  private readonly badge: HTMLElement | null = null;
  private readonly tools: HTMLElement;
  private readonly captionButton: HTMLButtonElement;
  private readonly presetButtons: HTMLButtonElement[];
  private readonly altPopover: FieldPopover;
  private node: Node;
  private stopDrag: (() => void) | null = null;

  constructor(private readonly host: ImageToolsHost, node: Node) {
    this.node = node;
    const doc = host.dom.ownerDocument;
    this.label = doc.createElement('div');
    this.label.className = 'typst-visual__box-label typst-visual__image-label';
    host.dom.prepend(this.label);
    if (host.picture) {
      this.frame = doc.createElement('div');
      this.frame.className = 'typst-visual__image-frame';
      this.badge = doc.createElement('span');
      this.badge.className = 'typst-visual__image-size';
      this.frame.append(host.picture, ...HANDLES.map((h) => this.handle(h)), this.badge);
      this.frame.addEventListener('dblclick', () => host.editCode());
      host.dom.insertBefore(this.frame, host.code);
    }
    this.tools = doc.createElement('div');
    this.tools.className = 'typst-visual__image-tools';
    this.tools.setAttribute('role', 'toolbar');
    this.tools.setAttribute('aria-label', 'Image');
    this.tools.addEventListener('mousedown', (event) => {
      if ((event.target as HTMLElement).closest('button')) event.preventDefault();
    });
    this.captionButton = this.button('Add caption', () => this.toggleCaption());
    this.presetButtons = PRESETS.map((percent) => {
      const button = this.button(`${percent}%`, () => this.run((state, pos) => resizeImage(state, pos, percent)));
      button.setAttribute('aria-label', `Width ${percent}%`);
      return button;
    });
    const altButton = this.button('Alt text', () => this.openAlt(altButton));
    const codeButton = this.button('Edit code', () => host.editCode());
    this.tools.append(this.captionButton, ...this.presetButtons, altButton, codeButton);
    host.dom.insertBefore(this.tools, host.code);
    this.altPopover = new FieldPopover(this.tools, {
      label: 'Alt text',
      field: 'Alt text',
      placeholder: 'What the image shows',
      apply: (alt) => this.run((state, pos) => setImageAlt(state, pos, alt)),
      remove: () => this.run((state, pos) => setImageAlt(state, pos, '')),
    });
    this.update(node);
  }

  /** The image node changed (e.g. its call was edited): heading, width and buttons follow. */
  update(node: Node): void {
    this.node = node;
    const path = imagePath(node.attrs.src);
    this.label.replaceChildren('Image: ', path === null ? '(no path)' : (this.host.pathLabel?.(path) ?? path));
    if (this.frame && !this.stopDrag) this.showWidth(imageWidthCss(node.attrs.src));
    this.refresh();
  }

  /** Brings the buttons up to date with the document (caption or not, current width). */
  refresh(): void {
    const pos = this.host.getPos();
    const info = pos === undefined ? null : imageInfo(this.host.editor.state, pos);
    this.captionButton.textContent = info?.caption ? 'Remove caption' : 'Add caption';
    for (const [i, button] of this.presetButtons.entries()) button.setAttribute('aria-pressed', String(info?.width === `${PRESETS[i]}%`));
  }

  destroy(): void {
    this.stopDrag?.();
    this.altPopover.destroy();
  }

  private toggleCaption(): void {
    const pos = this.host.getPos();
    const caption = pos !== undefined && imageInfo(this.host.editor.state, pos)?.caption;
    this.run(caption ? removeCaption : addCaption);
  }

  private openAlt(anchor: HTMLElement): void {
    if (this.altPopover.isOpen) return this.altPopover.close();
    const pos = this.host.getPos();
    const alt = pos === undefined ? null : imageInfo(this.host.editor.state, pos)?.alt;
    this.altPopover.open(anchor, alt ?? '', Boolean(alt));
  }

  /** Dispatches the edit for this image (if it applies) and returns the focus to the text. */
  private run(edit: (state: EditorState, pos: number) => Transaction | null): void {
    const pos = this.host.getPos();
    const { view } = this.host.editor;
    const tr = pos === undefined ? null : edit(view.state, pos);
    if (tr) view.dispatch(tr.scrollIntoView());
    view.focus();
    this.refresh();
  }

  private showWidth(width: string): void {
    this.frame!.style.width = width;
    this.frame!.classList.toggle('typst-visual__image-frame--sized', width !== '');
  }

  private button(text: string, click: () => void): HTMLButtonElement {
    const button = this.host.dom.ownerDocument.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.addEventListener('click', click);
    return button;
  }

  private handle(name: string): HTMLElement {
    const handle = this.host.dom.ownerDocument.createElement('span');
    handle.className = 'typst-visual__resize-handle';
    handle.dataset.handle = name;
    handle.addEventListener('pointerdown', (event) => this.startDrag(event, name.includes('w') ? -1 : 1));
    return handle;
  }

  /** Follows the pointer until it is released: the frame shows the new width, the source gets it at the end. */
  private startDrag(event: PointerEvent, direction: 1 | -1): void {
    event.preventDefault();
    event.stopPropagation();
    const frame = this.frame!;
    const container = frame.parentElement!;
    const style = getComputedStyle(container);
    const start: DragStart = {
      width: frame.getBoundingClientRect().width,
      reference: container.clientWidth - parseFloat(style.paddingLeft || '0') - parseFloat(style.paddingRight || '0'),
      centered: container.closest('figure') !== null,
    };
    const startX = event.clientX;
    let percent = resizedPercent(start, 0, direction);
    const doc = frame.ownerDocument;
    const move = (e: PointerEvent) => {
      percent = resizedPercent(start, e.clientX - startX, direction);
      this.showWidth(`${percent}%`);
      this.badge!.textContent = `${percent}%`;
    };
    const up = () => {
      this.stopDrag?.();
      this.run((state, pos) => resizeImage(state, pos, percent));
      this.update(this.node);
    };
    this.stopDrag = () => {
      doc.removeEventListener('pointermove', move);
      doc.removeEventListener('pointerup', up);
      frame.classList.remove('typst-visual__image-frame--resizing');
      this.stopDrag = null;
    };
    doc.addEventListener('pointermove', move);
    doc.addEventListener('pointerup', up);
    frame.classList.add('typst-visual__image-frame--resizing');
    this.badge!.textContent = `${percent}%`;
  }
}
