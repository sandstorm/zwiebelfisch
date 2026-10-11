// Layout: the widget's regions — side panels (rail buttons, resizable, collapsible, an overlay when narrow),
// editing area, preview, status bar; their sizes and open panels kept for the session. See workbench.ts and ARCHITECTURE.md, "Layout".

import type { Memory, SidePanel, SidePanelOptions } from '../workbench';
import type { SessionMemory } from '../memory/session-memory';

/** Below this widget width an open side panel lies over the editing area instead of beside it. */
const NARROW = 720;
const WIDTH = { min: 160, max: 480, initial: 240, step: 16 };
/** The preview's share of the widget's width, in percent (the editor/preview separator). */
const SHARE = { min: 20, max: 80, initial: 50, step: 5 };

/** What the layout remembers for the browser session: the panel width, the preview's share and the panels people opened or closed. */
interface Saved {
  width: number;
  preview: number;
  chosen: Record<string, boolean>;
}

/**
 * The widget's regions in one grid: on the left a rail with a button per side
 * panel and the open panel (resizable; one at a time), then the editing area
 * and the preview, with a separator between them (drag or arrow keys: the
 * preview's share of the width, 20–80%); the status bar below spans them all
 * (its items: StatusBar). Panels have ids
 * (`files`), so a later docking layout can take over the same contract.
 *
 * A panel is open by default as its owner says (`setDefault`) until someone
 * opens or closes it: that choice wins for the session. While the widget is
 * narrower than 720px an open panel lies over the editing area and closes on
 * Escape, a click outside, or `dismiss()` (e.g. after a file was chosen in it).
 */
export class Layout {
  readonly editor: HTMLElement;
  readonly preview: HTMLElement;
  readonly statusBar: HTMLElement;
  private readonly side: HTMLElement;
  private readonly rail: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly resizer: HTMLElement;
  private readonly split: HTMLElement;
  private readonly panels = new Map<string, { body: HTMLElement; button: HTMLButtonElement; order: number; fallback: boolean; available: boolean }>();
  private readonly saved: Memory<Saved>;
  private state: Saved;
  private openId: string | null = null;
  private narrow = false;
  private readonly cleanup: (() => void)[] = [];

  constructor(
    private readonly host: HTMLElement,
    memory: SessionMemory,
  ) {
    const doc = host.ownerDocument;
    this.side = div(doc, 'typst-editor__side');
    this.rail = div(doc, 'typst-editor__rail');
    this.rail.setAttribute('role', 'toolbar');
    this.rail.setAttribute('aria-label', 'Panels');
    this.rail.setAttribute('aria-orientation', 'vertical');
    this.panel = div(doc, 'typst-editor__panel');
    this.resizer = this.createResizer();
    this.panel.append(this.resizer);
    this.side.append(this.rail, this.panel);
    this.editor = div(doc, 'typst-editor__left');
    this.preview = div(doc, 'typst-editor__right');
    this.split = this.createSplit();
    this.preview.append(this.split);
    this.statusBar = div(doc, 'typst-editor__status-bar');
    host.append(this.side, this.editor, this.preview, this.statusBar);
    this.saved = memory.remember<Saved>('layout');
    this.state = { width: WIDTH.initial, preview: SHARE.initial, chosen: {}, ...this.saved.load() };
    this.showSplit();
    this.watchWidth();
    this.listen(doc, 'pointerdown', (event) => {
      // composedPath: inside <typst-editor>'s shadow root the document sees the host as the target.
      if (this.narrow && this.openId && !event.composedPath().includes(this.side)) this.show(null);
    });
    this.side.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.narrow && this.openId) this.closeFromKeyboard();
    });
    this.layout();
  }

  /**
   * Adds side panel `id` with its rail button (among the others by `options.order`, lower first; equal: registration
   * order): the element its content goes into, and how it opens.
   */
  addPanel(id: string, options: SidePanelOptions): SidePanel {
    if (this.panels.has(id)) throw new Error(`There is a side panel ${id} already`);
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
    button.addEventListener('click', () => this.choose(id, this.openId !== id));
    const order = options.order ?? 0;
    const next = [...this.panels.values()].find((panel) => panel.order > order);
    this.rail.insertBefore(button, next?.button ?? null);
    this.panel.insertBefore(body, this.resizer);
    this.panels.set(id, { body, button, order, fallback: false, available: true });
    this.layout();
    return {
      body,
      setDefault: (open) => this.setDefault(id, open),
      setAvailable: (available) => this.setAvailable(id, available),
      dismiss: () => this.dismiss(),
      dispose: () => this.removePanel(id),
    };
  }

  /** Removes side panel `id` and its rail button. */
  private removePanel(id: string): void {
    const panel = this.panels.get(id);
    if (!panel) return;
    panel.body.remove();
    panel.button.remove();
    this.panels.delete(id);
    if (this.openId === id) this.openId = null;
    this.layout();
  }

  /** Opens panel `id` by default (unless someone opened or closed it this session, or the widget is narrow). */
  private setDefault(id: string, open: boolean): void {
    const panel = this.panels.get(id);
    if (!panel || panel.fallback === open) return;
    panel.fallback = open;
    this.layout();
  }

  /** Shows or removes panel `id` and its rail button altogether (e.g. the setting `files.panel: 'hide'`). */
  private setAvailable(id: string, available: boolean): void {
    const panel = this.panels.get(id);
    if (!panel || panel.available === available) return;
    panel.available = available;
    this.layout();
  }

  /** Opens or closes panel `id` as someone's choice (remembered for the session). */
  private choose(id: string, open: boolean): void {
    // Narrow: the overlay opens and closes for the moment only.
    if (this.narrow) return this.show(open ? id : null);
    this.state.chosen = { ...this.state.chosen, [id]: open };
    if (open) for (const other of this.panels.keys()) if (other !== id) this.state.chosen[other] = false;
    this.saved.save(this.state);
    this.layout();
  }

  /** Closes the overlay panel of a narrow widget (nothing happens while the panel sits beside the editor). */
  private dismiss(): void {
    if (this.narrow && this.openId) this.show(null);
  }

  dispose(): void {
    for (const stop of this.cleanup) stop();
    this.side.remove();
    this.editor.remove();
    this.preview.remove();
    this.statusBar.remove();
    this.host.classList.remove('typst-editor--narrow');
    this.host.style.removeProperty('--te-preview-share');
  }

  /** Which panel is open: the session's choice, else the default; while narrow only the overlay opened now. */
  private layout(): void {
    if (this.narrow) return this.show(this.openId && this.panels.get(this.openId)?.available ? this.openId : null);
    let open: string | null = null;
    for (const [id, panel] of this.panels) {
      if (!panel.available) continue;
      const chosen = this.state.chosen[id];
      if (chosen ?? panel.fallback) open ??= id;
    }
    this.show(open);
  }

  private show(id: string | null): void {
    this.openId = id;
    this.side.hidden = ![...this.panels.values()].some((panel) => panel.available);
    for (const [panelId, panel] of this.panels) {
      panel.button.hidden = !panel.available;
      panel.button.setAttribute('aria-pressed', String(panelId === id));
      panel.body.hidden = panelId !== id;
    }
    this.panel.hidden = id === null;
    this.panel.style.width = `${this.state.width}px`;
    this.resizer.setAttribute('aria-valuenow', String(this.state.width));
  }

  private closeFromKeyboard(): void {
    const button = this.openId ? this.panels.get(this.openId)?.button : null;
    this.show(null);
    button?.focus();
  }

  /** Narrow or not, from the widget's width (ResizeObserver; without it the widget counts as wide). */
  private watchWidth(): void {
    const view = this.host.ownerDocument.defaultView;
    if (!view?.ResizeObserver) return;
    const observer = new view.ResizeObserver(() => {
      const narrow = this.host.clientWidth > 0 && this.host.clientWidth < NARROW;
      if (narrow === this.narrow) return;
      this.narrow = narrow;
      this.host.classList.toggle('typst-editor--narrow', narrow);
      // Entering narrow mode closes the panel instead of covering the text.
      if (narrow) this.show(null);
      else this.layout();
    });
    observer.observe(this.host);
    this.cleanup.push(() => observer.disconnect());
  }

  /** The panel's right edge: drag (or arrow keys) to change its width. */
  private createResizer(): HTMLElement {
    const resizer = div(this.host.ownerDocument, 'typst-editor__resizer');
    resizer.setAttribute('role', 'separator');
    resizer.setAttribute('aria-orientation', 'vertical');
    resizer.setAttribute('aria-label', 'Panel width');
    resizer.setAttribute('aria-valuemin', String(WIDTH.min));
    resizer.setAttribute('aria-valuemax', String(WIDTH.max));
    resizer.tabIndex = 0;
    resizer.addEventListener('keydown', (event) => {
      const step = { ArrowLeft: -WIDTH.step, ArrowRight: WIDTH.step }[event.key];
      if (step === undefined) return;
      event.preventDefault();
      this.resize(this.state.width + step);
    });
    resizer.addEventListener('pointerdown', (event) => this.drag(event));
    return resizer;
  }

  /** The separator between editing area and preview: drag (or arrow keys) to change the preview's share. */
  private createSplit(): HTMLElement {
    const split = div(this.host.ownerDocument, 'typst-editor__split');
    split.setAttribute('role', 'separator');
    split.setAttribute('aria-orientation', 'vertical');
    split.setAttribute('aria-label', 'Preview width');
    split.setAttribute('aria-valuemin', String(SHARE.min));
    split.setAttribute('aria-valuemax', String(SHARE.max));
    split.tabIndex = 0;
    split.addEventListener('keydown', (event) => {
      // the separator moves with the arrow: left makes the preview wider
      const step = { ArrowLeft: SHARE.step, ArrowRight: -SHARE.step }[event.key];
      if (step === undefined) return;
      event.preventDefault();
      this.setShare(this.state.preview + step);
    });
    split.addEventListener('pointerdown', (event) => {
      const box = this.host.getBoundingClientRect();
      this.track(event, (e) => this.setShare(((box.right - e.clientX) / box.width) * 100));
    });
    return split;
  }

  private setShare(percent: number): void {
    this.state.preview = Math.round(Math.min(SHARE.max, Math.max(SHARE.min, percent)));
    this.saved.save(this.state);
    this.showSplit();
  }

  private showSplit(): void {
    this.host.style.setProperty('--te-preview-share', `${this.state.preview}%`);
    this.split.setAttribute('aria-valuenow', String(this.state.preview));
  }

  private drag(event: PointerEvent): void {
    const start = { x: event.clientX, width: this.state.width };
    this.track(event, (e) => this.resize(start.width + e.clientX - start.x));
  }

  /** Follows the pointer from `event` until it is released, calling `move` (a resize in progress). */
  private track(event: PointerEvent, move: (event: PointerEvent) => void): void {
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

  private resize(width: number): void {
    this.state.width = Math.round(Math.min(WIDTH.max, Math.max(WIDTH.min, width)));
    this.saved.save(this.state);
    this.show(this.openId);
  }

  private listen<K extends keyof DocumentEventMap>(doc: Document, type: K, handler: (event: DocumentEventMap[K]) => void): void {
    doc.addEventListener(type, handler, true);
    this.cleanup.push(() => doc.removeEventListener(type, handler, true));
  }
}

function div(doc: Document, className: string): HTMLElement {
  const element = doc.createElement('div');
  element.className = className;
  return element;
}
