// See WorkbenchLayout in workbench-layout.ts.

import type { SidePanel, SidePanelOptions } from '../workbench';

/**
 * One side of the widget (left or right): its rail (a button per panel, by `order`) and at most one panel shown, sized
 * by a separator on the panel's inner edge (drag or arrow keys; remembered). Which panel shows: the viewer's pick (a
 * rail button; clicking the shown panel's button hides the side), else the side's default panel, else the first panel
 * whose owner asked for it (`setDefault`). As an overlay (`setOverlay`, the narrow widget's left side) a pick lasts for
 * the moment only, and Escape, a click outside or `dismiss()` close the panel.
 */
export class SideBar {
  readonly element: HTMLElement;
  readonly #rail: HTMLElement;
  /** Buttons that run something rather than show a panel, at the rail's far end. */
  readonly #actions: HTMLElement;
  readonly #panel: HTMLElement;
  readonly #resizer: HTMLElement;
  readonly #panels = new Map<string, PanelEntry>();
  readonly #size: (typeof SIZES)[Side];
  #shown: string | null = null;
  #defaultPanel: string | null | undefined;
  #overlay = false;
  readonly #cleanup: (() => void)[] = [];

  constructor(
    private readonly host: HTMLElement,
    readonly side: Side,
    /** Restored from what the viewer had; changed in place, then `save` is called. */
    readonly state: SideBarState,
    private readonly save: () => void,
  ) {
    const doc = host.ownerDocument;
    this.#size = SIZES[side];
    this.state.size = this.#clamp(state.size);
    this.element = div(doc, `typst-editor__side typst-editor__side--${side}`);
    this.#rail = div(doc, 'typst-editor__rail');
    this.#rail.setAttribute('role', 'toolbar');
    this.#rail.setAttribute('aria-label', side === 'left' ? 'Left panels' : 'Right panels');
    this.#rail.setAttribute('aria-orientation', 'vertical');
    this.#actions = div(doc, 'typst-editor__rail-actions');
    this.#rail.append(this.#actions);
    this.#panel = div(doc, 'typst-editor__panel');
    this.#resizer = this.#createResizer();
    this.#panel.append(this.#resizer);
    // the rail on the widget's outer edge
    if (side === 'left') this.element.append(this.#rail, this.#panel);
    else this.element.append(this.#panel, this.#rail);
    this.#listen(doc, 'pointerdown', (event) => {
      // composedPath: inside <typst-editor>'s shadow root the document sees the host as the target.
      if (this.#overlay && this.#shown && !event.composedPath().includes(this.element)) this.show(null);
    });
    this.element.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.#overlay && this.#shown) this.#closeFromKeyboard();
    });
    this.layout();
  }

  has(id: string): boolean {
    return this.#panels.has(id);
  }

  addPanel(id: string, options: SidePanelOptions): SidePanel {
    const doc = this.host.ownerDocument;
    const body = div(doc, 'typst-editor__panel-body');
    body.id = `typst-panel-${id}-${Math.random().toString(36).slice(2, 8)}`;
    body.dataset.panel = id;
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'typst-editor__rail-button';
    button.title = options.label;
    button.setAttribute('aria-label', options.label);
    button.setAttribute('aria-controls', body.id);
    button.dataset.testid = `typst-panel-toggle-${id}`;
    button.append(options.icon);
    button.addEventListener('click', () => this.#choose(this.#shown === id ? null : id));
    const order = options.order ?? 0;
    const next = [...this.#panels.values()].find((panel) => panel.order > order);
    this.#rail.insertBefore(button, next?.button ?? this.#actions);
    this.#panel.insertBefore(body, this.#resizer);
    this.#panels.set(id, { body, button, order, fallback: false, available: true });
    this.layout();
    return {
      body,
      setDefault: (open) => this.#update(id, { fallback: open }),
      setAvailable: (available) => this.#update(id, { available }),
      dismiss: () => this.#dismiss(),
      dispose: () => this.#remove(id),
    };
  }

  /** Puts `button` (one that runs something, not a panel's) at the rail's far end, until it is removed. */
  addAction(button: HTMLElement): void {
    button.classList.add('typst-editor__rail-button');
    this.#actions.append(button);
  }

  /** The panel the side shows until the viewer picks one (null: none), before any panel's `setDefault`; undefined: no such panel. */
  setDefaultPanel(id: string | null | undefined): void {
    this.#defaultPanel = id;
    this.layout();
  }

  /** As an overlay a pick is for the moment only; becoming one closes the panel instead of covering the text. */
  setOverlay(overlay: boolean): void {
    this.#overlay = overlay;
    if (overlay) this.show(null);
    else this.layout();
  }

  /** Shows the panel the viewer picked, else the default; as an overlay only the one opened now. */
  layout(): void {
    if (this.#overlay) return this.show(this.#shown && this.#isAvailable(this.#shown) ? this.#shown : null);
    this.show(this.#resolve());
  }

  show(id: string | null): void {
    this.#shown = id;
    this.element.hidden = ![...this.#panels.values()].some((panel) => panel.available);
    for (const [panelId, panel] of this.#panels) {
      panel.button.hidden = !panel.available;
      panel.button.setAttribute('aria-pressed', String(panelId === id));
      panel.body.hidden = panelId !== id;
    }
    this.#panel.hidden = id === null;
    this.#applySize();
  }

  dispose(): void {
    for (const stop of this.#cleanup) stop();
    this.element.remove();
    this.host.style.removeProperty('--te-right-side');
  }

  #resolve(): string | null {
    const chosen = this.state.chosen;
    if (chosen === null) return null;
    if (chosen !== undefined && this.#isAvailable(chosen)) return chosen;
    if (this.#defaultPanel === null) return null;
    if (this.#defaultPanel !== undefined && this.#isAvailable(this.#defaultPanel)) return this.#defaultPanel;
    for (const [id, panel] of this.#panels) if (panel.available && panel.fallback) return id;
    return null;
  }

  #isAvailable(id: string): boolean {
    return this.#panels.get(id)?.available ?? false;
  }

  /** The viewer picks `id` (null: hides the side), remembered; as an overlay for the moment only. */
  #choose(id: string | null): void {
    if (this.#overlay) return this.show(id);
    this.state.chosen = id;
    this.save();
    this.layout();
  }

  #update(id: string, change: Partial<Pick<PanelEntry, 'fallback' | 'available'>>): void {
    const panel = this.#panels.get(id);
    if (!panel) return;
    Object.assign(panel, change);
    this.layout();
  }

  #dismiss(): void {
    if (this.#overlay && this.#shown) this.show(null);
  }

  #remove(id: string): void {
    const panel = this.#panels.get(id);
    if (!panel) return;
    panel.body.remove();
    panel.button.remove();
    this.#panels.delete(id);
    if (this.#shown === id) this.#shown = null;
    this.layout();
  }

  #closeFromKeyboard(): void {
    const button = this.#shown ? this.#panels.get(this.#shown)?.button : null;
    this.show(null);
    button?.focus();
  }

  #applySize(): void {
    const size = this.state.size;
    if (this.#size.unit === 'px') this.#panel.style.width = `${size}px`;
    else if (this.#shown === null) this.host.style.removeProperty('--te-right-side');
    else this.host.style.setProperty('--te-right-side', `minmax(0, ${size}%)`);
    this.#resizer.setAttribute('aria-valuenow', String(size));
  }

  #clamp(size: number): number {
    return Math.round(Math.min(this.#size.max, Math.max(this.#size.min, size)));
  }

  #resize(size: number): void {
    this.state.size = this.#clamp(size);
    this.save();
    this.#applySize();
  }

  /** The panel's inner edge: drag (or arrow keys) to size the side; the arrow moves the edge. */
  #createResizer(): HTMLElement {
    const { min, max, step, label } = this.#size;
    const resizer = div(this.host.ownerDocument, 'typst-editor__resizer');
    resizer.setAttribute('role', 'separator');
    resizer.setAttribute('aria-orientation', 'vertical');
    resizer.setAttribute('aria-label', label);
    resizer.setAttribute('aria-valuemin', String(min));
    resizer.setAttribute('aria-valuemax', String(max));
    resizer.tabIndex = 0;
    // moving the edge outwards (away from the side's rail) makes the side wider
    const outwards = this.side === 'left' ? 1 : -1;
    resizer.addEventListener('keydown', (event) => {
      const direction = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
      if (direction === undefined) return;
      event.preventDefault();
      this.#resize(this.state.size + direction * outwards * step);
    });
    resizer.addEventListener('pointerdown', (event) => {
      const start = { x: event.clientX, size: this.state.size, width: this.host.getBoundingClientRect().width || 1 };
      const perPixel = this.#size.unit === 'px' ? 1 : 100 / start.width;
      this.#track(event, (e) => this.#resize(start.size + (e.clientX - start.x) * outwards * perPixel));
    });
    return resizer;
  }

  /** Follows the pointer from `event` until it is released, calling `move` (a resize in progress). */
  #track(event: PointerEvent, move: (event: PointerEvent) => void): void {
    event.preventDefault();
    const doc = this.host.ownerDocument;
    const up = () => {
      doc.removeEventListener('pointermove', move);
      doc.removeEventListener('pointerup', up);
      this.host.classList.remove('typst-editor--resizing');
    };
    this.host.classList.add('typst-editor--resizing');
    doc.addEventListener('pointermove', move);
    doc.addEventListener('pointerup', up);
  }

  #listen<K extends keyof DocumentEventMap>(doc: Document, type: K, handler: (event: DocumentEventMap[K]) => void): void {
    doc.addEventListener(type, handler, true);
    this.#cleanup.push(() => doc.removeEventListener(type, handler, true));
  }
}

export type Side = 'left' | 'right';

/** What a side keeps for the viewer: its size, and the panel the viewer picked (null: hid the side; undefined: none yet). */
export interface SideBarState {
  size: number;
  chosen?: string | null;
}

/** A side's state as stored (`value` comes from storage: any shape), with what is missing or malformed left out. */
export function restoreSideBarState(value: unknown, side: Side): SideBarState {
  const saved = isRecord(value) && isRecord(value[side]) ? value[side] : {};
  const chosen = typeof saved.chosen === 'string' || saved.chosen === null ? saved.chosen : undefined;
  return { size: typeof saved.size === 'number' ? saved.size : SIZES[side].initial, chosen };
}

export function div(doc: Document, className: string): HTMLElement {
  const element = doc.createElement('div');
  element.className = className;
  return element;
}

interface PanelEntry {
  body: HTMLElement;
  button: HTMLButtonElement;
  order: number;
  fallback: boolean;
  available: boolean;
}

/**
 * How a side is sized: the left one in pixels (the panel's width), the right one as a share of the widget in percent
 * (the grid column `--te-right-side`), so opening the left side narrows only the editing area.
 */
const SIZES = {
  left: { unit: 'px', min: 160, max: 480, initial: 240, step: 16, label: 'Left panel width' },
  right: { unit: '%', min: 20, max: 80, initial: 50, step: 5, label: 'Right panel width' },
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
