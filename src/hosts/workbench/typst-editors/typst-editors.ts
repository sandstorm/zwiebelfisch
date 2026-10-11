// TypstEditors. See workbench.ts and docs/30_architecture/07_workbench.typ.
import { Disposable } from '../../../core/disposable/disposable';
import type { Project } from '../../../core/project/project';
import type { SourceRange, TypstDocument } from '../../../core/typst-document/typst-document';
import { SOURCE_EDITOR, type SourceEditor, SourceEditorHost } from '../../source-editor/source-editor';
import { VISUAL_EDITOR, VisualEditor, VisualEditorHost } from '../../visual-editor/visual-editor';
import type { CustomEditorPanel, TextEditor, WindowApi } from '../../window/window';

/**
 * Per document, a Visual and a Source editor, each made the first time the document is shown in it, in its custom
 * editor's panel; kept (with cursor, scroll and undo history) while hidden, disposed with the panel (the file deleted).
 *
 * The Visual and Source editors as the two built-in custom editors of `*.typ` (`visualEditor`, `sourceEditor`), the
 * TextEditor of each document over them, and the editor frame.
 */
export class TypstEditors {
  readonly #editors = new Map<TypstDocument, DocumentEditor>();
  /** The editor whose view is shown, if any. */
  #active: DocumentEditor | null = null;
  /** Shown above and below the visible view (see `setFrame`). */
  #frame: { top: HTMLElement; bottom: HTMLElement } | null = null;
  readonly #visualEditor: VisualEditorHost;
  readonly #sourceEditors: SourceEditorHost;

  constructor(
    private readonly project: Project,
    private readonly options: TypstEditorsOptions = {},
  ) {
    this.#visualEditor = options.visualEditor ?? new VisualEditorHost();
    this.#sourceEditors = options.sourceEditors ?? new SourceEditorHost();
  }

  /** Registers the Visual and the Source editor as the custom editors of `*.typ`, Visual first: the default. */
  register(window: Pick<WindowApi, 'registerCustomEditorProvider'>): Disposable {
    return Disposable.from(
      ...[
        { viewType: VISUAL_EDITOR, displayName: 'Visual' },
        { viewType: SOURCE_EDITOR, displayName: 'Source' },
      ].map(({ viewType, displayName }) =>
        window.registerCustomEditorProvider(
          viewType,
          { resolveCustomEditor: (file, panel) => this.#resolve(viewType, this.project.document(file.path)!, panel) },
          { filenamePattern: '*.typ', displayName, retainContextWhenHidden: true },
        ),
      ),
    );
  }

  /** The editor of the document shown; null while no view of these is shown. */
  get activeTextEditor(): DocumentEditor | null {
    return this.#active;
  }

  /**
   * Shows `top` right before and `bottom` right after the visible view's content (in the Visual editor below its
   * toolbar, above the first block), in its scrolling panel, so they are the first and last thing of the file; across
   * view and document switches; detached while no view is shown. null removes the frame.
   */
  setFrame(frame: { top: HTMLElement; bottom: HTMLElement } | null): void {
    this.#removeFrame();
    this.#frame = frame;
    this.#placeFrame();
  }

  #resolve(viewType: string, document: TypstDocument, panel: CustomEditorPanel): void {
    let editor = this.#editors.get(document);
    if (!editor) this.#editors.set(document, (editor = new DocumentEditor(document)));
    const owner = editor;
    const element = panel.element;
    element.classList.add('typst-editor__pane');
    const selected = () => this.options.onSelection?.(owner);
    const view =
      viewType === VISUAL_EDITOR
        ? new VisualEditor(element, document, this.#visualEditor)
        : this.#sourceEditors.createView(element, document, { onSelection: selected });
    // disposed with the view
    if (view instanceof VisualEditor) view.onDidChangeSelection(selected);
    editor.views.set(viewType, { view, panel });
    const followVisibility = () => {
      if (panel.visible) this.#shown(owner, viewType);
      else if (this.#active === owner && owner.viewType === viewType) this.#shown(null, viewType);
    };
    followVisibility();
    panel.onDidChangeViewState(followVisibility);
    panel.onDidDispose(() => {
      if (this.#active === owner && owner.viewType === viewType) this.#shown(null, viewType);
      view.dispose();
      owner.views.delete(viewType);
      if (owner.views.size === 0) this.#editors.delete(document);
    });
  }

  #shown(editor: DocumentEditor | null, viewType: string): void {
    this.#removeFrame();
    if (editor) editor.viewType = viewType;
    this.#active = editor;
    this.#placeFrame();
  }

  #placeFrame(): void {
    const shown = this.#active?.views.get(this.#active.viewType);
    if (!this.#frame || !shown) return;
    const pane = shown.panel.element;
    // the Visual editor's toolbar stays on top; the Source editor is all content
    const content = shown.view instanceof VisualEditor ? shown.view.content : pane.firstElementChild;
    pane.insertBefore(this.#frame.top, content);
    pane.append(this.#frame.bottom);
  }

  #removeFrame(): void {
    this.#frame?.top.remove();
    this.#frame?.bottom.remove();
  }
}

export interface TypstEditorsOptions {
  /** What every document's Visual editor shows and offers (default: paragraphs and raw Typst only). */
  visualEditor?: VisualEditorHost;
  /** Makes the Source editors, with what is registered there (language, lint, file links, …); default: plain ones. */
  sourceEditors?: SourceEditorHost;
  /** The selection in a view of `editor`'s document moved, or its text changed (the view already has the new selection). */
  onSelection?(editor: DocumentEditor): void;
}

/** A document's editor: the views it has (made when first shown), used through the one shown last. */
export class DocumentEditor implements TextEditor {
  /** By view type. */
  readonly views = new Map<string, ShownView>();
  viewType: string = VISUAL_EDITOR;

  constructor(readonly document: TypstDocument) {}

  get selection(): SourceRange {
    return this.views.get(this.viewType)!.view.selection();
  }

  revealRange(range: SourceRange): void {
    this.views.get(this.viewType)!.view.reveal(range);
  }
}

interface ShownView {
  readonly view: VisualEditor | SourceEditor;
  readonly panel: CustomEditorPanel;
}
