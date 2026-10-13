import type { TypstExtension } from '../../hosts/workbench/workbench';
import { calculatePastedImports, copiedImports, IMPORTS_TYPE, parseCopiedImports } from './model/pasted-imports';

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
 * The editors do the paste; this extension is a paste edit provider (`languages.registerDocumentPasteEditProvider`):
 * it adds the imports to the clipboard on a copy and the import change to whatever a paste puts in (it resolves every
 * paste edit). See docs/20_features/01_wysiwyg-editing.typ.
 */
export function imports(): TypstExtension {
  return {
    id: 'imports',
    activate({ languages, subscriptions }) {
      subscriptions.push(
        languages.registerDocumentPasteEditProvider(
          { language: 'typst' },
          {
            prepareDocumentPaste(document, copied, dataTransfer) {
              const found = copiedImports(document.text, document.path, copied);
              if (found.length > 0) dataTransfer.setData(IMPORTS_TYPE, JSON.stringify(found));
            },
            resolveDocumentPasteEdit(edit, document, ranges, dataTransfer) {
              const copied = parseCopiedImports(dataTransfer.getData(IMPORTS_TYPE));
              const imports = calculatePastedImports(document, { ranges, text: edit.insertText }, copied, languages.provideKnownImports('typst'));
              return { ...edit, additionalEdit: [...(edit.additionalEdit ?? []), ...imports] };
            },
          },
          { providedPasteEditKinds: [] },
        ),
      );
    },
  };
}
