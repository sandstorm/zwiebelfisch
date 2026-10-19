import { Annotation, type Extension } from '@codemirror/state';
import type { Disposable } from '../../core/disposable/disposable';
import type { TypstDocument } from '../../core/typst-document/typst-document';

/**
 * The Source editors (CodeMirror 6 bound to a `TypstDocument`: a Typst file as plain text) and their contribution
 * points (what `ExtensionContext.sourceEditor` offers).
 *
 * Used by:
 * - the workbench, which registers the Source editor for `*.typ` and makes the editors (`SourceEditorHost.createEditor`)
 * - extensions, which contribute CodeMirror extensions (the Typst language, diagnostics, other users' carets, links)
 * - the widget's other CodeMirror editors (raw boxes, the text files' editor), which take the shared contributions
 *   (`createSharedCodeMirrorExtension`)
 *
 * A contribution applies to every editor, open or made later. Text and selection stay in sync with the document both
 * ways.
 */
export interface SourceEditorContributions {
  /**
   * Adds CodeMirror extensions to every Source editor, the existing ones included, until disposed: the same value for
   * all of them, or made per editor from what the editor shows (`SourceEditorContext`).
   */
  registerCodeMirrorExtension(extension: Extension | ((editor: SourceEditorContext) => Extension)): Disposable;
  /**
   * Adds a CodeMirror extension to every CodeMirror of the widget that shows text, not only Typst, the existing ones
   * included, until disposed: the Source editors, the raw boxes' code, and the editors that include
   * `createSharedCodeMirrorExtension()` (the text files'). For what fits any text (shown whitespace), never a language.
   */
  registerSharedCodeMirrorExtension(extension: Extension): Disposable;
  /**
   * What a CodeMirror made elsewhere (an extension's own editor) includes to get the shared extensions
   * (`registerSharedCodeMirrorExtension`), those registered now and later, until it is destroyed.
   */
  createSharedCodeMirrorExtension(): Extension;
}

/** What a contribution knows about the one Source editor it is applied to. */
export interface SourceEditorContext {
  /** The document the editor edits. */
  readonly document: TypstDocument;
}

/**
 * Marks a Source editor's transactions that mirror a change of its document made elsewhere (another editor, the API,
 * another user), with that change's origin. The editor does not send them back; a contribution may look at the origin,
 * e.g. to keep some changes out of the undo history (`EditorState.transactionExtender`).
 */
export const fromDocument = Annotation.define<{ readonly origin: unknown }>();

export interface SourceEditorOptions {
  /** Called after the selection moved or the text changed; `selection()` already returns the new selection. */
  onSelection?(): void;
}

/**
 * The view type of the Source editor's custom editor, for `workbench.open(path, { viewType })`,
 * `TextEditor.viewType` and the menu context key `activeCustomEditorId`.
 */
export const SOURCE_EDITOR = 'sourceEditor';

export { SourceEditorHost, SourceEditor } from './source-editor-impl';
