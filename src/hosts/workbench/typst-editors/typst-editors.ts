// See WorkbenchHost in ../workbench.ts and docs/30_architecture/07_workbench.typ, "Concepts".
import { Disposable } from '../../../core/disposable/disposable';
import type { Project } from '../../../core/project/project';
import type { SourceRange, TypstDocument } from '../../../core/typst-document/typst-document';
import { SOURCE_EDITOR, type SourceEditor, SourceEditorHost } from '../../source-editor/source-editor';
import { VISUAL_EDITOR, VisualEditor, VisualEditorHost } from '../../visual-editor/visual-editor';
import type { CustomEditorPanel, TextEditor, WindowApi } from '../../window/window';

/**
 * The Visual and Source editors as the two built-in custom editors of `*.typ` (`visualEditor`, `sourceEditor`), the
 * `TextEditor` of each document over them, and the editor frame. Per document, each editor is made the first time
 * the document is shown in it, in its custom editor's panel; kept (with cursor, scroll and undo history) while hidden,
 * disposed with the panel (the file deleted).
 */
export class TypstEditors {
  readonly #editors = new Map<TypstDocument, DocumentEditor>();
  /** The document editor shown, if any. */
  #active: DocumentEditor | null = null;
  /** Shown above and below the visible editor (see `setFrame`). */
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

  /** The editor of the document shown; null while none of these editors is shown. */
  get activeTextEditor(): DocumentEditor | null {
    return this.#active;
  }

  /**
   * Shows `top` right before and `bottom` right after the visible editor's content (in the Visual editor below its
   * toolbar, above the first block), in its scrolling panel, so they are the first and last thing of the file; across
   * editor and document switches; detached while none of these editors is shown. null removes the frame.
   */
  setFrame(frame: { top: HTMLElement; bottom: HTMLElement } | null): void {
    this.#removeFrame();
    this.#frame = frame;
    this.#placeFrame();
  }

  #resolve(viewType: string, document: TypstDocument, panel: CustomEditorPanel): void {
    let documentEditor = this.#editors.get(document);
    if (!documentEditor) this.#editors.set(document, (documentEditor = new DocumentEditor(document)));
    const owner = documentEditor;
    const element = panel.element;
    element.classList.add('typst-editor__pane');
    const selected = () => this.options.onSelection?.(owner);
    const editor =
      viewType === VISUAL_EDITOR
        ? new VisualEditor(element, document, this.#visualEditor)
        : this.#sourceEditors.createEditor(element, document, { onSelection: selected });
    // disposed with the editor
    if (editor instanceof VisualEditor) editor.onDidChangeSelection(selected);
    owner.editors.set(viewType, { editor, panel });
    const followVisibility = () => {
      if (panel.visible) this.#shown(owner, viewType);
      else if (this.#active === owner && owner.viewType === viewType) this.#shown(null, viewType);
    };
    followVisibility();
    panel.onDidChangeViewState(followVisibility);
    panel.onDidDispose(() => {
      if (this.#active === owner && owner.viewType === viewType) this.#shown(null, viewType);
      editor.dispose();
      owner.editors.delete(viewType);
      if (owner.editors.size === 0) this.#editors.delete(document);
    });
  }

  #shown(editor: DocumentEditor | null, viewType: string): void {
    this.#removeFrame();
    if (editor) editor.viewType = viewType;
    this.#active = editor;
    this.#placeFrame();
  }

  #placeFrame(): void {
    const shown = this.#active?.editors.get(this.#active.viewType);
    if (!this.#frame || !shown) return;
    const pane = shown.panel.element;
    // the Visual editor's toolbar stays on top; the Source editor is all content
    const content = shown.editor instanceof VisualEditor ? shown.editor.content : pane.firstElementChild;
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
  /** The selection in an editor of `editor`'s document moved, or its text changed (the editor already has the new selection). */
  onSelection?(editor: DocumentEditor): void;
}

/** A document's editor: the Visual and Source editors it has (made when first shown), used through the one shown last. */
export class DocumentEditor implements TextEditor {
  /** By view type. */
  readonly editors = new Map<string, ShownEditor>();
  viewType: string = VISUAL_EDITOR;

  constructor(readonly document: TypstDocument) {}

  get selection(): SourceRange {
    return this.editors.get(this.viewType)!.editor.selection();
  }

  revealRange(range: SourceRange): void {
    this.editors.get(this.viewType)!.editor.reveal(range);
  }

  insertSnippet(snippet: string): void {
    this.editors.get(this.viewType)!.editor.insert(snippet);
  }
}

interface ShownEditor {
  readonly editor: VisualEditor | SourceEditor;
  readonly panel: CustomEditorPanel;
}
