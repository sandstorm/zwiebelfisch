// The resize handles of an image box. See images in ../images.ts.
import type { Node } from '@tiptap/pm/model';
import { NodeSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import type { RawBoxContext, RawBoxExtension } from '../../../hosts/visual-editor/visual-editor';
import { imageWidthCss, withImageWidth } from '../model/image-call';
import { type DragStart, resizedPercent } from '../model/resize';

/**
 * The resize frame of an image box: a frame around the rendered picture showing the image's width, with drag handles
 * to change it. Clicking the picture selects the box (showing the image bar) instead of opening the code;
 * double-clicking it shows the code.
 *
 * A drag changes the width live and writes `width: NN%` once, on release: one undo step that rewrites only that
 * argument.
 */
export class ImageTools implements RawBoxExtension {
  private readonly frame: HTMLElement | null = null;
  private readonly badge: HTMLElement | null = null;
  private node: Node;
  private stopDrag: (() => void) | null = null;

  constructor(private readonly host: RawBoxContext) {
    this.node = host.node();
    const doc = host.dom.ownerDocument;
    host.dom.classList.add('zwf-images__box');
    if (host.picture) {
      this.frame = doc.createElement('div');
      this.frame.className = 'zwf-images__frame';
      this.badge = doc.createElement('span');
      this.badge.className = 'zwf-images__size';
      this.frame.append(host.picture, ...HANDLES.map((h) => this.handle(h)), this.badge);
      this.frame.addEventListener('dblclick', () => host.editCode());
      const picture = host.picture;
      picture.addEventListener('mousedown', (event) => this.selectBox(event));
      // an SVG with only a viewBox has no size of its own: it would shrink to nothing, so it fills the text width
      picture.addEventListener('load', () => this.frame!.classList.toggle('zwf-images__frame--no-size', picture.naturalWidth === 0));
      host.dom.insertBefore(this.frame, host.code);
    }
    this.update(this.node);
  }

  /** The image node changed (e.g. its call was edited): the width follows. */
  update(node: Node): void {
    this.node = node;
    if (this.frame && !this.stopDrag) this.showWidth(imageWidthCss(node.attrs.src));
  }

  dispose(): void {
    this.stopDrag?.();
  }

  /** A click on the picture selects the box as a whole in the outer editor, rather than opening the code. */
  private selectBox(event: MouseEvent): void {
    const pos = this.host.getPos();
    if (event.button !== 0 || pos === undefined) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const { view } = this.host.tiptap;
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
    view.focus();
  }

  /** Dispatches the edit for this image (if it applies) and returns the focus to the text. */
  private run(edit: (state: EditorState, pos: number) => Transaction | null): void {
    const pos = this.host.getPos();
    const { view } = this.host.tiptap;
    const tr = pos === undefined ? null : edit(view.state, pos);
    if (tr) view.dispatch(tr.scrollIntoView());
    view.focus();
  }

  private showWidth(width: string): void {
    this.frame!.style.width = width;
    this.frame!.classList.toggle('zwf-images__frame--sized', width !== '');
  }

  private handle(name: string): HTMLElement {
    const handle = this.host.dom.ownerDocument.createElement('span');
    handle.className = 'zwf-images__resize-handle';
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
      frame.classList.remove('zwf-images__frame--resizing');
      this.stopDrag = null;
    };
    doc.addEventListener('pointermove', move);
    doc.addEventListener('pointerup', up);
    frame.classList.add('zwf-images__frame--resizing');
    this.badge!.textContent = `${percent}%`;
  }
}

/** Resize handles: corners and sides; `w` in the name means it sits on the left. */
const HANDLES = ['nw', 'ne', 'sw', 'se', 'w', 'e'];

/**
 * Sets the `width` of the image block at `pos` (bare, or the body of a figure) to `percent` of the text width (whole
 * percent), as one transaction; null if there is no image there or the width is that already. Only the argument
 * changes; the serializer prints everything else of the block as it was.
 */
function resizeImage(state: EditorState, pos: number, percent: number): Transaction | null {
  const image = state.doc.nodeAt(pos);
  if (image?.type.name !== 'image') return null;
  const src = withImageWidth(image.attrs.src, percent);
  return src === image.attrs.src ? null : state.tr.setNodeAttribute(pos, 'src', src);
}
