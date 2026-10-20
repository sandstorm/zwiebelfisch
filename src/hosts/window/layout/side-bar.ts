// See WindowLayout in window-layout.ts.

import type { Disposable } from '../../../core/disposable/disposable';
import { EventEmitter } from '../../../core/event-emitter/event-emitter';
import type { SidePanel, SidePanelOptions } from '../window';

/**
 * One side of the widget (left or right): its rail (a button per panel, by `order`, in its top or bottom group) and at most one panel shown, sized
 * by a separator on the panel's inner edge (drag or arrow keys; remembered). Which panel shows: the viewer's pick (a
 * rail button; clicking the shown panel's button hides the side), else the side's default panel, else the first panel
 * whose owner asked for it (`setDefault`). As an overlay (`setOverlay`, the narrow widget's left side) a pick lasts for
 * the moment only, and Escape, a click outside or `dismiss()` close the panel. Each panel's command
 * `workbench.view.<id>` picks it from the keyboard; its rail button's tooltip names the key.
 *
 * @internal Extensions add panels through `window.registerSidePanel`.
 */
export class SideBar {
  readonly element: HTMLElement;
  readonly #rail: HTMLElement;
  /** The rail's buttons at its far end (`alignment: 'bottom'`); the others go before it. */
  readonly #bottom: HTMLElement;
  /** Each rail button's `order`. */
  readonly #orders = new WeakMap<Element, number>();
  readonly #panel: HTMLElement;
  readonly #resizer: HTMLElement;
  readonly #panels = new Map<string, PanelEntry>();
  /** The buttons of `setActions`. */
  #actions: HTMLElement[] = [];
  readonly #size: (typeof SIZES)[Side];
  #shown: string | null = null;
  #defaultPanel: string | null | undefined;
  #overlay = false;
  /** Where the focus was before a panel's command focused it, to go back there when the command hides it. */
  #returnFocus: HTMLElement | null = null;
  readonly #cleanup: (() => void)[] = [];

  constructor(
    private readonly host: HTMLElement,
    readonly side: Side,
    /** Restored from what the viewer had; changed in place, then `owner.save` is called. */
    readonly state: SideBarState,
    private readonly owner: SideBarOwner,
  ) {
    const doc = host.ownerDocument;
    this.#size = SIZES[side];
    this.state.size = this.#clamp(state.size);
    this.element = div(doc, `zwf-editor__side zwf-editor__side--${side}`);
    this.#rail = div(doc, 'zwf-editor__rail');
    this.#rail.setAttribute('role', 'toolbar');
    this.#rail.setAttribute('aria-label', side === 'left' ? 'Left panels' : 'Right panels');
    this.#rail.setAttribute('aria-orientation', 'vertical');
    this.#bottom = div(doc, 'zwf-editor__rail-bottom');
    this.#rail.append(this.#bottom);
    this.#panel = div(doc, 'zwf-editor__panel');
    this.#resizer = this.#createResizer();
    this.#panel.append(this.#resizer);
    // the rail on the widget's outer edge
    if (side === 'left') this.element.append(this.#rail, this.#panel);
    else this.element.append(this.#panel, this.#rail);
    this.#listen(doc, 'pointerdown', (event) => {
      // composedPath: inside <zwiebelfisch-editor>'s shadow root the document sees the host as the target.
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
    const body = div(doc, 'zwf-editor__panel-body');
    body.id = `zwf-panel-${id}-${Math.random().toString(36).slice(2, 8)}`;
    body.dataset.panel = id;
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'zwf-editor__rail-button';
    const command = `workbench.view.${id}`;
    // the key may be bound after the panel is added: named anew whenever the tooltip may show
    const describe = () => {
      const key = this.owner.commands.keybindingLabel(command);
      button.title = key ? `${options.label} (${key})` : options.label;
    };
    describe();
    button.addEventListener('pointerenter', describe);
    button.addEventListener('focus', describe);
    button.setAttribute('aria-label', options.label);
    button.setAttribute('aria-controls', body.id);
    button.dataset.testid = `zwf-panel-toggle-${id}`;
    button.insertAdjacentHTML('beforeend', options.icon);
    button.addEventListener('click', () => this.#choose(this.#shown === id ? null : id));
    this.#place(button, options.order ?? 0, options.alignment === 'bottom');
    this.#panel.insertBefore(body, this.#resizer);
    const registration = this.owner.commands.registerCommand(command, () => this.#toggleFocus(id));
    const entry: PanelEntry = { body, button, registration, fallback: false, available: true, visible: false, visibility: new EventEmitter<void>() };
    this.#panels.set(id, entry);
    this.layout();
    return {
      body,
      get visible() {
        return entry.visible;
      },
      onDidChangeVisibility: entry.visibility.event,
      setDefault: (open) => this.#update(id, { fallback: open }),
      setAvailable: (available) => this.#update(id, { available }),
      show: (preserveFocus) => this.#reveal(id, preserveFocus ?? false),
      dismiss: () => this.#dismiss(),
      dispose: () => this.#remove(id),
    };
  }

  /**
   * Shows `actions` (buttons that run a command, not a panel's) among the rail's top buttons by `order`, in place of
   * those before. The tooltip names the command's key.
   */
  setActions(actions: readonly RailAction[]): void {
    for (const button of this.#actions) button.remove();
    const doc = this.host.ownerDocument;
    this.#actions = actions.map(({ command, title, icon, order }) => {
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'zwf-editor__rail-button';
      button.dataset.command = command;
      button.setAttribute('aria-label', title);
      button.innerHTML = icon;
      const describe = () => {
        const key = this.owner.commands.keybindingLabel(command);
        button.title = key ? `${title} (${key})` : title;
      };
      describe();
      button.addEventListener('pointerenter', describe);
      button.addEventListener('focus', describe);
      button.addEventListener('click', () => void this.owner.commands.executeCommand(command).catch((error: unknown) => console.error(`Command ${command} failed:`, error)));
      this.#place(button, order, false);
      return button;
    });
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
    // told after the layout is done, so a listener sees it as it is
    for (const [panelId, panel] of this.#panels) {
      const visible = panelId === id && panel.available;
      if (visible === panel.visible) continue;
      panel.visible = visible;
      panel.visibility.fire();
    }
  }

  dispose(): void {
    for (const stop of this.#cleanup) stop();
    this.element.remove();
    this.host.style.removeProperty('--zwf-right-side');
  }

  /** Inserts `button` into the rail's top or bottom group, before the first of its buttons with a higher order. */
  #place(button: HTMLElement, order: number, bottom: boolean): void {
    this.#orders.set(button, order);
    const group = bottom ? this.#bottom : this.#rail;
    const next = [...group.children].find((other) => (this.#orders.get(other) ?? -Infinity) > order);
    group.insertBefore(button, next ?? (bottom ? null : this.#bottom));
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
    this.owner.save();
    this.layout();
  }

  #update(id: string, change: Partial<Pick<PanelEntry, 'fallback' | 'available'>>): void {
    const panel = this.#panels.get(id);
    if (!panel) return;
    Object.assign(panel, change);
    this.layout();
  }

  /**
   * Shows panel `id` as the viewer's pick and, unless `preserveFocus`, focuses it (where the focus was is remembered):
   * its element marked `autofocus` (as a dialog's), else its first focusable one, else the panel itself.
   */
  #reveal(id: string, preserveFocus: boolean): void {
    if (!this.#isAvailable(id)) return;
    this.#choose(id);
    if (preserveFocus) return;
    const root = this.host.getRootNode() as Document | ShadowRoot;
    const body = this.#panels.get(id)!.body;
    if (!body.contains(root.activeElement)) this.#returnFocus = root.activeElement instanceof HTMLElement ? root.activeElement : null;
    const target = body.querySelector<HTMLElement>('[autofocus]') ?? body.querySelector<HTMLElement>(FOCUSABLE) ?? body;
    if (target === body) body.tabIndex = -1;
    target.focus();
  }

  /** `workbench.view.<id>`: shows and focuses panel `id`, or hides the side while it is shown and has the focus. */
  #toggleFocus(id: string): void {
    const body = this.#panels.get(id)?.body;
    const root = this.host.getRootNode() as Document | ShadowRoot;
    if (this.#shown !== id || !body?.contains(root.activeElement)) return this.#reveal(id, false);
    this.#choose(null);
    if (this.#returnFocus?.isConnected) this.#returnFocus.focus();
    this.#returnFocus = null;
  }

  #dismiss(): void {
    if (this.#overlay && this.#shown) this.show(null);
  }

  #remove(id: string): void {
    const panel = this.#panels.get(id);
    if (!panel) return;
    panel.body.remove();
    panel.button.remove();
    panel.registration.dispose();
    panel.visibility.dispose();
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
    else if (this.#shown === null) this.host.style.removeProperty('--zwf-right-side');
    else this.host.style.setProperty('--zwf-right-side', `minmax(0, ${size}%)`);
    this.#resizer.setAttribute('aria-valuenow', String(size));
  }

  #clamp(size: number): number {
    return Math.round(Math.min(this.#size.max, Math.max(this.#size.min, size)));
  }

  #resize(size: number): void {
    this.state.size = this.#clamp(size);
    this.owner.save();
    this.#applySize();
  }

  /** The panel's inner edge: drag (or arrow keys) to size the side; the arrow moves the edge. */
  #createResizer(): HTMLElement {
    const { min, max, step, label } = this.#size;
    const resizer = div(this.host.ownerDocument, 'zwf-editor__resizer');
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
      this.host.classList.remove('zwf-editor--resizing');
    };
    this.host.classList.add('zwf-editor--resizing');
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

/** What a side needs of the whole layout: to save the state of both sides, and the commands. */
export interface SideBarOwner {
  save(): void;
  readonly commands: PanelCommands;
}

/** What the side needs of the commands: to register each panel's, run an action's, and the key of one. */
export interface PanelCommands {
  registerCommand(id: string, handler: () => void): Disposable;
  executeCommand(id: string): Promise<unknown>;
  keybindingLabel(id: string): string | undefined;
}

/** A rail button that runs `command` (an item of the menu `workbench/rail/<side>`). */
export interface RailAction {
  readonly command: string;
  /** Its tooltip and accessible name. */
  readonly title: string;
  /** SVG markup drawn in `currentColor`. */
  readonly icon: string;
  /** Its place among the side's panels' buttons (lower first). */
  readonly order: number;
}

interface PanelEntry {
  body: HTMLElement;
  button: HTMLButtonElement;
  /** Its command `workbench.view.<id>`. */
  registration: Disposable;
  fallback: boolean;
  available: boolean;
  /** As told last through `visibility`. */
  visible: boolean;
  visibility: EventEmitter<void>;
}

/**
 * How a side is sized: the left one in pixels (the panel's width), the right one as a share of the widget in percent
 * (the grid column `--zwf-right-side`), so opening the left side narrows only the editing area.
 */
const SIZES = {
  left: { unit: 'px', min: 160, max: 480, initial: 240, step: 16, label: 'Left panel width' },
  right: { unit: '%', min: 20, max: 80, initial: 50, step: 5, label: 'Right panel width' },
} as const;

/** What can take the focus in a panel: the first of these gets it when the panel is shown from the keyboard. */
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
