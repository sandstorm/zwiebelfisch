// See WorkbenchHost in ../workbench.ts and docs/40_architecture/07_workbench.typ, "Concepts".

import type { Memento, SidePanel, SidePanelOptions } from '../workbench';
import { div, restoreSideBarState, SideBar, type PanelCommands, type Side } from './side-bar';

/**
 * The widget's regions in one grid: the left side (a rail with a button per side panel and the shown panel), the
 * editing area, the right side (the shown panel and its rail, on the outer edge), and the status bar below spanning
 * them all (its items: StatusBar). Each side shows one panel at a time; clicking the shown one's rail button hides
 * the side and the editing area takes the room. Sizes and the panels picked are remembered for the session (`layout`
 * in the memento). Panels have ids (`files`, `preview`), so a later docking layout can take over the same contract.
 *
 * While the widget is narrower than 720px the left side's panel lies over the editing area and closes on Escape, a
 * click outside, or `dismiss()` (e.g. after a file was chosen in it).
 */
export class WorkbenchLayout {
  readonly editor: HTMLElement;
  readonly statusBar: HTMLElement;
  readonly #sides: Record<Side, SideBar>;
  readonly #cleanup: (() => void)[] = [];

  constructor(
    private readonly host: HTMLElement,
    /** Where the layout keeps its state for the browser session (key `layout`). */
    memento: Memento,
    /** Where each panel's command `workbench.view.<id>` goes, and the keys its rail button names. */
    commands: PanelCommands,
  ) {
    const doc = host.ownerDocument;
    const saved = memento.get<unknown>('layout');
    const save = () => void memento.update('layout', { left: this.#sides.left.state, right: this.#sides.right.state });
    this.#sides = {
      left: new SideBar(host, 'left', restoreSideBarState(saved, 'left'), { save, commands }),
      right: new SideBar(host, 'right', restoreSideBarState(saved, 'right'), { save, commands }),
    };
    this.editor = div(doc, 'zwf-editor__editor-area');
    this.statusBar = div(doc, 'zwf-editor__status-bar');
    host.append(this.#sides.left.element, this.editor, this.#sides.right.element, this.statusBar);
    this.#watchWidth();
  }

  /**
   * Adds side panel `id` with its rail button on `options.side` (default left), in the rail's top or bottom group
   * (`options.alignment`, default top), among the others there by `options.order` (lower first; equal: registration
   * order): the element its content goes into, and how it opens; and its command `workbench.view.<id>`.
   */
  addPanel(id: string, options: SidePanelOptions): SidePanel {
    if (this.#sides.left.has(id) || this.#sides.right.has(id)) throw new Error(`There is a side panel ${id} already`);
    return this.#sides[options.side ?? 'left'].addPanel(id, options);
  }

  /** Puts `button` among the top buttons of `side`'s rail by `order`, as a panel's (shown while the side has a panel). */
  addRailAction(side: Side, button: HTMLElement, order: number): void {
    this.#sides[side].addAction(button, order);
  }

  /**
   * The panel `side` shows until the viewer picks one (null: the side starts hidden), before the panels' own
   * `setDefault`; undefined: none named.
   */
  setDefaultPanel(side: Side, id: string | null | undefined): void {
    this.#sides[side].setDefaultPanel(id);
  }

  dispose(): void {
    for (const stop of this.#cleanup) stop();
    this.#sides.left.dispose();
    this.#sides.right.dispose();
    this.editor.remove();
    this.statusBar.remove();
    this.host.classList.remove('zwf-editor--narrow');
  }

  /** Narrow or not, from the widget's width (ResizeObserver; without it the widget counts as wide). */
  #watchWidth(): void {
    const view = this.host.ownerDocument.defaultView;
    if (!view?.ResizeObserver) return;
    let narrow = false;
    const observer = new view.ResizeObserver(() => {
      const now = this.host.clientWidth > 0 && this.host.clientWidth < NARROW;
      if (now === narrow) return;
      narrow = now;
      this.host.classList.toggle('zwf-editor--narrow', narrow);
      this.#sides.left.setOverlay(narrow);
    });
    observer.observe(this.host);
    this.#cleanup.push(() => observer.disconnect());
  }
}

/** Below this widget width the left side's open panel lies over the editing area instead of beside it. */
const NARROW = 720;
