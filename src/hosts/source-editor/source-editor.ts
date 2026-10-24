import { Annotation, type Extension } from '@codemirror/state';
import type { Disposable } from '../../core/disposable/disposable';
import type { ProjectPath } from '../../core/paths/paths';
import type { TypstDocument } from '../../core/typst-document/typst-document';

/**
 * The widget's CodeMirrors and what extensions add to them (what `ExtensionContext.sourceEditor` offers):
 * - the Source editors (CodeMirror 6 bound to a `TypstDocument`: a Typst file as plain text)
 * - the code of the Visual editor's raw boxes
 * - an extension's own CodeMirror (the text files' editor), which takes them through `codeMirrorExtensionsFor`
 *
 * A contribution applies to every CodeMirror it selects, open or made later. A Source editor's text and selection
 * stay in sync with its document both ways.
 */
export interface SourceEditorContributions {
  /**
   * Adds CodeMirror extensions to every CodeMirror `selector` selects, the existing ones included, until disposed: the
   * same value for all of them, or made per CodeMirror from what it shows (`CodeMirrorContext`).
   */
  registerCodeMirrorExtension(selector: CodeMirrorSelector, extension: Extension | ((editor: CodeMirrorContext) => Extension)): Disposable;
  /**
   * What a CodeMirror made elsewhere (an extension's own) includes to get the extensions registered for it, now and
   * later, until it is destroyed; `editor` says what it shows (`editor: 'other'`).
   */
  codeMirrorExtensionsFor(editor: CodeMirrorContext): Extension;
}

/** CodeMirrors by language and kind (as `DocumentFilter`); empty: every CodeMirror. */
export interface CodeMirrorSelector {
  readonly language?: string;
  readonly editor?: CodeMirrorContext['editor'];
}

/**
 * What a contribution knows about the one CodeMirror it is applied to. `editor`: a Source editor, a raw box's code or
 * another CodeMirror; the first two show Typst of `document`.
 */
export type CodeMirrorContext =
  | (CodeMirrorText & { readonly editor: 'source' | 'rawBox'; readonly document: TypstDocument })
  | (CodeMirrorText & { readonly editor: 'other' });

/** The text a CodeMirror shows. */
interface CodeMirrorText {
  /** Its language: `typst` (Source editors, raw boxes), `bibtex`, `plaintext`, … */
  readonly languageId: string;
  /** The project file it is in, now (a file can be renamed); null: none. */
  path(): ProjectPath | null;
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
  /** The file the document is, now, for the contributions (`CodeMirrorContext.path`); default: none. */
  path?(): ProjectPath | null;
  /** Takes no edit, only the document's own changes (a file as it was at a commit); default: editable. */
  readOnly?: boolean;
}

/**
 * The view type of the Source editor, for `window.showDocument(path, { viewType })`,
 * `TextEditor.viewType` and the menu context key `activeEditorId`.
 */
export const SOURCE_EDITOR = 'sourceEditor';

export { SourceEditorHost, SourceEditor } from './source-editor-impl';
