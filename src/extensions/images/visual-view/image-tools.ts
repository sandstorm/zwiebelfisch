// ImageTools: resize handles, width presets, alt text and caption on an image box. See ../images.ts.
import type { PathReference } from '../../../core/paths/paths';
import type { Node } from '@tiptap/pm/model';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import type { RawBoxTools, RawBoxToolsHost } from '../../../hosts/visual-view/visual-view';
import type { WindowApi } from '../../../hosts/window/window';
import { imageWidthCss } from '../model/image-call';
import { type DragStart, resizedPercent } from '../model/resize';
import { imageInfo, resizeImage, setImageAlt } from './image-edits';
import { imagePath } from './image-syntax';

/** The image box the tools belong to (its picture moves into the resize frame). */
export interface ImageToolsHost extends RawBoxToolsHost {
  /** The image's path (in the call `src`) in the heading, e.g. as a link to the file (default: the text). */
  pathLabel?: ((path: PathReference, src: string) => globalThis.Node) | null;
  /** Where "Alt text" asks for the text (the window's input box; default: no "Alt text"). */
  prompts?: Pick<WindowApi, 'showInputBox'>;
}

/** Width presets offered as buttons (keyboard-friendly resizing). */
const PRESETS = [25, 50, 75, 100];
/** Resize handles: corners and sides; `w` in the name means it sits on the left. */
const HANDLES = ['nw', 'ne', 'sw', 'se', 'w', 'e'];

/**
 * What an image box offers besides its code: the "Image: path" heading, a
 * frame around the rendered picture showing the image's width with drag
 * handles to change it, and, while the image is selected, a small toolbar
 * (add/remove caption where the figures extension's commands are there,
 * preset widths, alt text, the box actions others contribute, edit the code).
 *
 * Every change is one transaction from `image-edits`, so one undo step that
 * rewrites only the argument concerned. A drag changes the width live in the
 * view and writes `width: NN%` once, on release.
 */
export class ImageTools implements RawBoxTools {
  private readonly label: HTMLElement;
  private readonly frame: HTMLElement | null = null;
  private readonly badge: HTMLElement | null = null;
  private readonly tools: HTMLElement;
  private readonly captionButton: HTMLButtonElement;
  private readonly presetButtons: HTMLButtonElement[];
  private node: Node;
  private stopDrag: (() => void) | null = null;

  constructor(private readonly host: ImageToolsHost, node: Node) {
    this.node = node;
    const doc = host.dom.ownerDocument;
    host.dom.classList.add('typst-images__box');
    this.label = doc.createElement('div');
    this.label.className = 'typst-visual__box-label typst-images__label';
    host.dom.prepend(this.label);
    if (host.picture) {
      this.frame = doc.createElement('div');
      this.frame.className = 'typst-images__frame';
      this.badge = doc.createElement('span');
      this.badge.className = 'typst-images__size';
      this.frame.append(host.picture, ...HANDLES.map((h) => this.handle(h)), this.badge);
      this.frame.addEventListener('dblclick', () => host.editCode());
      host.dom.insertBefore(this.frame, host.code);
    }
    this.tools = doc.createElement('div');
    this.tools.className = 'typst-images__tools';
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
    const prompts = host.prompts;
    const altButtons = prompts ? [this.button('Alt text', () => void this.askAlt(prompts))] : [];
    const codeButton = this.button('Edit code', () => host.editCode());
    // the box actions of other contributions ("Edit diagram") go before "Edit code", as buttons of the toolbar
    host.actions.classList.add('typst-images__actions');
    this.tools.append(this.captionButton, ...this.presetButtons, ...altButtons, host.actions, codeButton);
    host.dom.insertBefore(this.tools, host.code);
    this.update(node);
  }

  /** The image node changed (e.g. its call was edited): heading, width and buttons follow. */
  update(node: Node): void {
    this.node = node;
    const path = imagePath(node.attrs.src);
    this.label.replaceChildren('Image: ', path === null ? '(no path)' : (this.host.pathLabel?.(path, node.attrs.src) ?? path));
    if (this.frame && !this.stopDrag) this.showWidth(imageWidthCss(node.attrs.src));
    this.refresh();
  }

  /** The image was selected: its toolbar shows (CSS) with the buttons up to date. */
  select(): void {
    this.refresh();
  }

  /** Brings the buttons up to date with the document (caption or not, current width). */
  private refresh(): void {
    const pos = this.host.getPos();
    const info = pos === undefined ? null : imageInfo(this.host.editor.state, pos);
    const caption = this.captionCommand();
    this.captionButton.hidden = caption === null;
    this.captionButton.textContent = caption === 'removeFigureCaption' ? 'Remove caption' : 'Add caption';
    for (const [i, button] of this.presetButtons.entries()) button.setAttribute('aria-pressed', String(info?.width === `${PRESETS[i]}%`));
  }

  dispose(): void {
    this.stopDrag?.();
  }

  private toggleCaption(): void {
    const pos = this.host.getPos();
    const command = this.captionCommand();
    if (pos !== undefined && command) this.host.editor.commands[command](pos);
    this.host.editor.view.focus();
    this.refresh();
  }

  /** What the caption button does now: the figures extension's command that applies, if that extension is there. */
  private captionCommand(): 'addFigureCaption' | 'removeFigureCaption' | null {
    const pos = this.host.getPos();
    const { editor } = this.host;
    // another extension's commands: guarded, the figures may be left out
    if (pos === undefined || !('addFigureCaption' in editor.commands)) return null;
    if (editor.can().removeFigureCaption(pos)) return 'removeFigureCaption';
    return editor.can().addFigureCaption(pos) ? 'addFigureCaption' : null;
  }

  /** Asks for the alt text (an empty one removes it) and sets it. */
  private async askAlt(prompts: Pick<WindowApi, 'showInputBox'>): Promise<void> {
    const pos = this.host.getPos();
    const alt = (pos === undefined ? null : imageInfo(this.host.editor.state, pos)?.alt) ?? '';
    const text = await prompts.showInputBox({
      title: 'Alt text',
      prompt: alt ? 'Alt text (empty removes it)' : 'Alt text',
      value: alt,
      placeHolder: 'What the image shows',
    });
    if (text === undefined) return this.host.editor.view.focus();
    this.run((state, at) => setImageAlt(state, at, text.trim()));
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
    this.frame!.classList.toggle('typst-images__frame--sized', width !== '');
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
    handle.className = 'typst-images__resize-handle';
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
      frame.classList.remove('typst-images__frame--resizing');
      this.stopDrag = null;
    };
    doc.addEventListener('pointermove', move);
    doc.addEventListener('pointerup', up);
    frame.classList.add('typst-images__frame--resizing');
    this.badge!.textContent = `${percent}%`;
  }
}
