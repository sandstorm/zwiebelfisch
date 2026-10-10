// EditingViews: the Visual/Source tabs; lazily one VisualView and SourceView per document. See workbench.ts.
import type { TypstDocument } from '../../../core/typst-document/typst-document';
import { type SourceView, SourceViewHost } from '../../source-view/source-view';
import { VisualView, VisualViewContributions } from '../../visual-view/visual-view';

export type EditorMode = 'visual' | 'source';

export interface EditingViewsOptions {
  /** The editing view shown first (default: visual). */
  mode?: EditorMode;
  /** The selection in a view of `editor`'s document moved, or its text changed (the views already show the new selection). */
  onSelection?(editor: DocumentEditor): void;
  /** What every document's Visual view shows and offers (default: paragraphs and raw Typst only). */
  visualView?: VisualViewContributions;
  /** Makes the Source views, with what is registered there (language, lint, file links, …); default: plain ones. */
  sourceViews?: SourceViewHost;
}

interface Views {
  panes: Record<EditorMode, HTMLElement>;
  visual: VisualView;
  source: SourceView;
  editor: DocumentEditor;
}

/**
 * A document's editor (`TextEditor` in workbench.ts): its two views, used through the tab chosen in the
 * EditingViews that made it.
 */
export class DocumentEditor {
  constructor(
    readonly document: TypstDocument,
    private readonly views: { readonly visual: VisualView; readonly source: SourceView },
    private readonly tabs: { readonly mode: EditorMode },
  ) {}

  get mode(): EditorMode {
    return this.tabs.mode;
  }

  get selection(): { from: number; to: number } {
    return this.views[this.mode].selection();
  }

  revealRange(from: number, to: number): void {
    this.views[this.mode].reveal(from, to);
  }
}

/**
 * The Visual/Source tabs and, per document, a VisualView and a SourceView.
 * A document's views are created the first time it is shown and kept (with
 * their cursor and undo history) while other documents are shown.
 */
export class EditingViews {
  private readonly tabs: HTMLElement;
  private readonly buttons: HTMLButtonElement[];
  private readonly views = new Map<TypstDocument, Views>();
  private active: TypstDocument | null = null;
  private current: EditorMode;
  /** Tab-bar controls that only show in one view. */
  private readonly modeActions = new Map<HTMLElement, EditorMode>();
  /** Shown above and below the visible view (see `setFrame`). */
  private frame: { top: HTMLElement; bottom: HTMLElement } | null = null;
  private readonly sourceViews: SourceViewHost;

  constructor(
    private readonly parent: HTMLElement,
    private readonly options: EditingViewsOptions = {},
  ) {
    const doc = parent.ownerDocument;
    this.current = options.mode ?? 'visual';
    this.sourceViews = options.sourceViews ?? new SourceViewHost();
    this.tabs = div(doc, 'typst-editor__tabs');
    this.tabs.setAttribute('role', 'tablist');
    this.buttons = (['visual', 'source'] as const).map((mode) => {
      const button = doc.createElement('button');
      button.className = 'typst-editor__tab';
      button.setAttribute('role', 'tab');
      button.textContent = mode === 'visual' ? 'Visual' : 'Source';
      button.dataset.mode = mode;
      return button;
    });
    this.tabs.append(...this.buttons);
    this.tabs.addEventListener('click', (event) => {
      const mode = (event.target as HTMLElement).closest<HTMLElement>('[data-mode]')?.dataset.mode;
      if (mode === 'visual' || mode === 'source') this.switchTo(mode);
    });
    parent.append(this.tabs);
  }

  get mode(): EditorMode {
    return this.current;
  }

  /** Shows the views of `document`, creating them on first use; null hides all of them. */
  show(document: TypstDocument | null): void {
    this.active = document;
    if (document) this.ensure(document);
    this.tabs.hidden = document === null;
    this.layout();
  }

  /** The views of `document`, created (hidden) if it was not shown yet. */
  viewsOf(document: TypstDocument): { visual: VisualView; source: SourceView } {
    const views = this.ensure(document);
    this.layout();
    return views;
  }

  /** The editor of the shown document; null while no document is shown. */
  activeEditor(): DocumentEditor | null {
    return (this.active && this.views.get(this.active)?.editor) ?? null;
  }

  /** Puts a control (e.g. the "Comment" button) at the end of the tab bar; with `mode`, it only shows in that view. Returns its removal. */
  addTabAction(element: HTMLElement, mode?: EditorMode): () => void {
    if (mode) this.modeActions.set(element, mode);
    this.tabs.append(element);
    this.layout();
    return () => {
      this.modeActions.delete(element);
      element.remove();
    };
  }

  /**
   * Shows `top` right before and `bottom` right after the visible view's
   * content (in the Visual view below its toolbar, above the first block), in
   * its scrolling pane, so they are the first and last thing of the file;
   * across tab and document switches; detached while no document is shown.
   * null removes the frame.
   */
  setFrame(frame: { top: HTMLElement; bottom: HTMLElement } | null): void {
    this.frame?.top.remove();
    this.frame?.bottom.remove();
    this.frame = frame;
    this.layout();
  }

  /**
   * Reveals `from..to` of the shown document in the current view, or in the view of
   * `mode`, switching to its tab so that the range is visible.
   */
  reveal(from: number, to: number, mode?: EditorMode): void {
    const views = this.active && this.views.get(this.active);
    if (!views) return;
    if (mode && this.current !== mode) this.switchTo(mode);
    views[this.current].reveal(from, to);
  }

  /** Destroys the views of every document not in `documents` (deleted files). */
  retain(documents: TypstDocument[]): void {
    for (const document of [...this.views.keys()]) {
      if (!documents.includes(document)) this.drop(document);
    }
  }

  destroy(): void {
    for (const document of [...this.views.keys()]) this.drop(document);
    this.tabs.remove();
  }

  /** The views of `document`, created if it has none yet. */
  private ensure(document: TypstDocument): Views {
    let views = this.views.get(document);
    if (!views) {
      views = this.create(document);
      this.views.set(document, views);
    }
    return views;
  }

  private create(document: TypstDocument): Views {
    const doc = this.parent.ownerDocument;
    const panes = { visual: div(doc, 'typst-editor__pane'), source: div(doc, 'typst-editor__pane') };
    // After the tabs (and any earlier panes): only one pair is ever visible.
    this.parent.insertBefore(panes.visual, this.tabs.nextSibling);
    panes.visual.after(panes.source);
    const visual = new VisualView(panes.visual, document, this.options.visualView ?? new VisualViewContributions());
    const source = this.sourceViews.createView(panes.source, document, { onSelection: () => this.options.onSelection?.(editor) });
    const editor = new DocumentEditor(document, { visual, source }, this);
    const views: Views = { panes, visual, source, editor };
    // disposed with the view
    visual.onDidChangeSelection(() => this.options.onSelection?.(editor));
    return views;
  }

  private drop(document: TypstDocument): void {
    const views = this.views.get(document)!;
    views.visual.destroy();
    views.source.destroy();
    views.panes.visual.remove();
    views.panes.source.remove();
    this.views.delete(document);
    if (this.active === document) this.active = null;
  }

  private switchTo(mode: EditorMode): void {
    this.current = mode;
    this.layout();
  }

  private layout(): void {
    for (const button of this.buttons) button.setAttribute('aria-selected', String(button.dataset.mode === this.current));
    for (const [element, mode] of this.modeActions) element.hidden = mode !== this.current;
    for (const [document, { panes }] of this.views) {
      panes.visual.hidden = document !== this.active || this.current !== 'visual';
      panes.source.hidden = document !== this.active || this.current !== 'source';
    }
    this.placeFrame();
  }

  private placeFrame(): void {
    if (!this.frame) return;
    const views = this.active && this.views.get(this.active);
    if (!views) {
      this.frame.top.remove();
      this.frame.bottom.remove();
      return;
    }
    const pane = views.panes[this.current];
    // the Visual view's toolbar stays on top; the Source view is all content
    const content = this.current === 'visual' ? views.visual.content : pane.firstElementChild;
    if (content !== this.frame.top && content?.previousSibling !== this.frame.top) pane.insertBefore(this.frame.top, content);
    if (pane.lastChild !== this.frame.bottom) pane.append(this.frame.bottom);
  }
}

function div(doc: Document, className: string): HTMLElement {
  const element = doc.createElement('div');
  element.className = className;
  return element;
}
