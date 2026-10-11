import type { TextChange, TypstDocument } from '../../core/typst-document/typst-document';
import type { TypstExtension } from '../../hosts/workbench/workbench';
import { calculatePastedImports, copiedImports, IMPORTS_TYPE, parseCopiedImports, type CopiedImport } from './model/pasted-imports';
import { sourceEditorImports } from './source-editor/source-editor-imports';
import { visualEditorImports } from './visual-editor/visual-editor-imports';

/**
 * Imports follow copied Typst. Pasted text that uses a name the file neither defines nor imports gets its import, in
 * the same undo step: `mermaid(..)` pasted into a file without merman adds `#import "@preview/merman:0.4.0": mermaid`
 * at the top, or `mermaid` to an import of merman already there. Never a duplicate.
 *
 * Where a name comes from: a copy from the Visual editor (its raw boxes too) or the Source editor puts the imports of
 * the source file that the copied text uses on the clipboard (`application/x-typst-imports`, JSON, file modules as
 * project paths), so a paste into another file imports them from there, the path written from the target file. Text
 * from elsewhere gets what extensions declare for their constructs (`languages.registerKnownImport`: mermaid from
 * merman), without this extension knowing them. Star imports do not travel (which of their names a text uses is
 * unknown).
 *
 * The editors do the paste; this extension only adds the imports: an appended transaction after a Visual editor's
 * paste (the host reads the text as Typst, see docs/30_architecture/04_visual-editor.typ), a transaction filter after
 * a Source editor's. See docs/10_guide/02_features.typ, "Writing".
 */
export function imports(): TypstExtension {
  return {
    id: 'imports',
    activate({ project, languages, visualEditor, sourceEditor, subscriptions }) {
      const clipboard: ImportsClipboard = {
        copy(document, copied, data) {
          const file = project.pathOf(document);
          const found = file ? copiedImports(document.text, file, copied) : [];
          if (found.length > 0) data.setData(IMPORTS_TYPE, JSON.stringify(found));
        },
        paste: (data) => parseCopiedImports(data.getData(IMPORTS_TYPE)),
        changes(document, before, after, copied) {
          const file = project.pathOf(document);
          return file ? calculatePastedImports({ file, before, after }, copied, languages.provideKnownImports('typst')) : [];
        },
      };
      subscriptions.push(
        visualEditor.registerTiptapExtension(({ document }) => visualEditorImports(document, clipboard)),
        sourceEditor.registerCodeMirrorExtension(({ document }) => sourceEditorImports(document, clipboard)),
      );
    },
  };
}

/** What the editors' parts of imports use: what a copy adds to the clipboard, what a paste brings, and the changes after it. */
export interface ImportsClipboard {
  /** Adds the imports of `document` that `copied` (the text copied from it) uses to the clipboard `data`. */
  copy(document: TypstDocument, copied: string, data: DataTransfer): void;
  /** The copied imports on the clipboard `data` of a paste (none: text from elsewhere). */
  paste(data: DataTransfer): CopiedImport[];
  /** The changes, in order, importing what a paste into `document` (its text `before` and `after` it) newly uses. */
  changes(document: TypstDocument, before: string, after: string, copied: readonly CopiedImport[]): TextChange[];
}

/**
 * Calls `clipboard.copy` on every copy and cut in `element`, after the editor's own handling has set the clipboard's
 * text: its listeners, added when it was made, or on an element inside `element`, run first. Returns the removal.
 */
export function addCopyListener(element: HTMLElement, document: TypstDocument, clipboard: ImportsClipboard): () => void {
  const listener = (event: ClipboardEvent) => {
    const data = event.clipboardData;
    const copied = data?.getData('text/plain') ?? '';
    if (data && copied !== '') clipboard.copy(document, copied, data);
  };
  element.addEventListener('copy', listener);
  element.addEventListener('cut', listener);
  return () => {
    element.removeEventListener('copy', listener);
    element.removeEventListener('cut', listener);
  };
}
