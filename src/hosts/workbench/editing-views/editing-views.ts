// EditingViews: the Visual/Source tabs; lazily one VisualView and SourceView per document. See workbench.ts.
import type { Highlight, TypstDocument } from '../../../core/typst-document/typst-document';
import type { DocumentLinkProvider } from '../../../core/document-links/document-links';
import { describeDiagnostic, SourceView, type SourceDiagnostic } from '../../../features/source-view/source-view';
import { VisualView, type VisualViewOptions } from '../../../features/visual-view/visual-view';

export type EditorMode = 'visual' | 'source';

export interface EditingViewsOptions {
  /** The editing view shown first (default: visual). */
  mode?: EditorMode;
  /** The cursor moved in a view of `document` the user works in (focused). */
  onCursor?(document: TypstDocument, offset: number): void;
  /** The selection in a view of `document` moved, or its text changed (the views already show the new selection). */
  onSelection?(document: TypstDocument): void;
  /** Options for the Visual view of `document` (rendered raw boxes, images to insert). */
  visualOptions?(document: TypstDocument): VisualViewOptions;
  /** Where the file paths in `document` lead (both views open them); default: plain text. */
  documentLinks?(document: TypstDocument): DocumentLinkProvider;
}

interface Views {
  panes: Record<EditorMode, HTMLElement>;
  visual: VisualView;
  source: SourceView;
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
  private readonly diagnostics = new Map<TypstDocument, SourceDiagnostic[]>();
  private active: TypstDocument | null = null;
  private current: EditorMode;
  /** Tab-bar controls that only show in one view. */
  private readonly modeActions = new Map<HTMLElement, EditorMode>();
  /** Shown above and below the visible view (see `setFrame`). */
  private frame: { top: HTMLElement; bottom: HTMLElement } | null = null;

  constructor(
    private readonly parent: HTMLElement,
    private readonly options: EditingViewsOptions = {},
  ) {
    const doc = parent.ownerDocument;
    this.current = options.mode ?? 'visual';
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

  /** The shown document and the view it is shown in; null while no document is shown. */
  shown(): { document: TypstDocument; view: VisualView | SourceView } | null {
    const views = this.active && this.views.get(this.active);
    return views ? { document: this.active!, view: views[this.current] } : null;
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

  /** Marks `diagnostics` in both views of `document`, now or when they are created. */
  setDiagnostics(document: TypstDocument, diagnostics: SourceDiagnostic[]): void {
    this.diagnostics.set(document, diagnostics);
    const views = this.views.get(document);
    if (views) markDiagnostics(views, diagnostics);
  }

  /** Destroys the views of every document not in `documents` (deleted files). */
  retain(documents: TypstDocument[]): void {
    for (const document of [...this.views.keys()]) {
      if (!documents.includes(document)) this.drop(document);
    }
    for (const document of [...this.diagnostics.keys()]) {
      if (!documents.includes(document)) this.diagnostics.delete(document);
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
    const documentLinks = this.options.documentLinks?.(document);
    const views: Views = {
      panes,
      visual: new VisualView(panes.visual, document, {
        ...this.options.visualOptions?.(document),
        documentLinks,
        onSelection: () => {
          // like the source view's onCursor: where the user works, for the preview to follow
          if (views.visual.focused()) this.options.onCursor?.(document, views.visual.selection().from);
          this.options.onSelection?.(document);
        },
      }),
      source: new SourceView(panes.source, document, {
        documentLinks,
        onCursor: (offset) => this.options.onCursor?.(document, offset),
        onSelection: () => this.options.onSelection?.(document),
      }),
    };
    const diagnostics = this.diagnostics.get(document);
    if (diagnostics) markDiagnostics(views, diagnostics);
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

/**
 * The Source view underlines diagnostics with hover (CodeMirror lint); the
 * Visual view gets highlights with the same text as tooltip. An empty range
 * (e.g. "expected expression" at a point) still marks one character.
 */
function markDiagnostics(views: Views, diagnostics: SourceDiagnostic[]): void {
  views.source.setDiagnostics(diagnostics);
  views.visual.setHighlights('diagnostics', diagnostics.map((d): Highlight => ({
    from: d.from,
    to: Math.max(d.to, d.from + 1),
    className: 'typst-diagnostic',
    attributes: { 'data-severity': d.severity, title: describeDiagnostic(d) },
  })));
}

function div(doc: Document, className: string): HTMLElement {
  const element = doc.createElement('div');
  element.className = className;
  return element;
}
