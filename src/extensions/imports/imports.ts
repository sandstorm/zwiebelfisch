import type { Extension } from '../../hosts/workbench/workbench';
import { calculatePastedImports, copiedImports, IMPORTS_TYPE, parseCopiedImports } from './model/pasted-imports';

/**
 * Imports that follow copied Typst.
 * Pasted text that uses a name the target file neither defines nor imports gets its import, in the same undo step and
 * never as a duplicate: `mermaid(..)` pasted into a file without merman adds `#import "@preview/merman:0.4.0": mermaid`,
 * or adds `mermaid` to an import of merman already there.
 *
 * Where the import comes from:
 * - a copy from a Typst file: the imports of that file the copied text uses, the path written from the target file
 * - text from elsewhere: what extensions declare for their constructs (`languages.registerKnownImport`)
 *
 * Star imports do not travel.
 */
export function imports(): Extension {
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
