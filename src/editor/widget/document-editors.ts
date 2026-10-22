// The Typst files' editors in the window. See Widget in widget.ts.
import { Disposable } from '../../core/disposable/disposable';
import type { Project } from '../../core/project/project';
import type { SourceRange, TextChange, TypstDocument } from '../../core/typst-document/typst-document';
import { SOURCE_EDITOR, type SourceEditor, type SourceEditorHost } from '../../hosts/source-editor/source-editor';
import { VISUAL_EDITOR, VisualEditor, type VisualEditorHost } from '../../hosts/visual-editor/visual-editor';
import type { EditorPanel, TextEditor, TextEditorEdit, WindowApi } from '../../hosts/window/window';

/**
 * The Visual and Source editors as the two editors of `*.typ` (`visualEditor`, `sourceEditor`), with the
 * `TextEditor` of each document over them as their panels' `textEditor`. Used by:
 * - Widget
 *
 * Per document, each editor is made the first time the document is shown in it; kept (with scroll and undo history)
 * while hidden, disposed with the panel (the file deleted). Switching a document between the two keeps the selection.
 */
export class DocumentEditors {
  readonly #editors = new Map<TypstDocument, DocumentEditor>();

  constructor(
    private readonly project: Project,
    private readonly options: DocumentEditorsOptions,
  ) {}

  /** Registers the Visual and the Source editor as the editors of `*.typ`, Visual first: the default. */
  register(window: Pick<WindowApi, 'registerEditorProvider'>): Disposable {
    return Disposable.from(
      ...[
        { viewType: VISUAL_EDITOR, displayName: 'Visual' },
        { viewType: SOURCE_EDITOR, displayName: 'Source' },
      ].map(({ viewType, displayName }) =>
        window.registerEditorProvider(
          viewType,
          { resolveEditor: (file, panel) => this.#resolve(viewType, this.project.document(file.path)!, panel) },
          { filenamePattern: '*.typ', displayName, retainContextWhenHidden: true },
        ),
      ),
    );
  }

  #resolve(viewType: string, document: TypstDocument, panel: EditorPanel): void {
    let documentEditor = this.#editors.get(document);
    if (!documentEditor) this.#editors.set(document, (documentEditor = new DocumentEditor(document)));
    const owner = documentEditor;
    const element = panel.element;
    element.classList.add('zwf-editor__pane');
    const selected = () => this.options.onSelection(owner);
    const editor =
      viewType === VISUAL_EDITOR
        ? new VisualEditor(element, document, this.options.visualEditor)
        : this.options.sourceEditors.createEditor(element, document, { onSelection: selected, path: () => this.project.pathOf(document) ?? null });
    // disposed with the editor
    if (editor instanceof VisualEditor) editor.onDidChangeSelection(selected);
    owner.editors.set(viewType, editor);
    panel.textEditor = owner;
    // the Visual editor's toolbar stays above the header; the Source editor is all content
    panel.contentElement = editor instanceof VisualEditor ? editor.content : (element.firstElementChild ?? undefined);
    const followVisibility = () => {
      if (panel.visible) owner.show(viewType);
    };
    followVisibility();
    panel.onDidChangeViewState(followVisibility);
    panel.onDidRequestReveal((range) => editor.reveal(range));
    panel.onDidDispose(() => {
      editor.dispose();
      owner.editors.delete(viewType);
      if (owner.editors.size === 0) this.#editors.delete(document);
    });
  }
}

export interface DocumentEditorsOptions {
  /** What every document's Visual editor shows and offers. */
  visualEditor: VisualEditorHost;
  /** Makes the Source editors, with what is registered there (language, lint, file links, …). */
  sourceEditors: SourceEditorHost;
  /**
   * The selection in an editor of `editor`'s document moved, or its text changed: fired from the editors' own updates,
   * so the editor has the new selection already.
   */
  onSelection(editor: DocumentEditor): void;
}

/** A document's editor: the Visual and Source editors it has (made when first shown), used through the one shown last. */
export class DocumentEditor implements TextEditor {
  /** By view type. */
  readonly editors = new Map<string, VisualEditor | SourceEditor>();
  viewType: string = VISUAL_EDITOR;

  constructor(readonly document: TypstDocument) {}

  /** Shows the document in its editor `viewType`; switched from the other one, at the selection that one had. */
  show(viewType: string): void {
    const previous = this.viewType === viewType ? undefined : this.editors.get(this.viewType);
    this.viewType = viewType;
    if (previous) this.revealRange(previous.selection());
  }

  get selection(): SourceRange {
    return this.editors.get(this.viewType)!.selection();
  }

  revealRange(range: SourceRange): void {
    this.editors.get(this.viewType)!.reveal(range);
  }

  insertSnippet(snippet: string): void {
    this.editors.get(this.viewType)!.insert(snippet);
  }

  edit(callback: (editBuilder: TextEditorEdit) => void): void {
    const changes: TextChange[] = [];
    callback({
      replace: ({ from, to }, insert) => changes.push({ from, to, insert }),
      insert: (offset, insert) => changes.push({ from: offset, to: offset, insert }),
      delete: ({ from, to }) => changes.push({ from, to, insert: '' }),
    });
    this.editors.get(this.viewType)!.edit(changes);
  }
}
