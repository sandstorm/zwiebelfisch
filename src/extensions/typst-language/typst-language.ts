import { ProjectPath } from '../../core/paths/paths';
import { quote } from '../../core/typst-syntax/typst-syntax';
import type { DocumentDropEditProvider } from '../../hosts/languages/languages';
import type { TypstExtension } from '../../hosts/workbench/workbench';
import { typstSyntax } from './source-editor/typst-syntax';
import { TYPST_HELP } from './workbench/typst-help';

/**
 * Typst as a language for CodeMirror: highlighting and indentation. It goes into every Source editor and into the code
 * of the Visual editor's raw boxes. The help sheet "Typst basics" is here too, and what a Typst file dragged from the
 * file panel into another becomes: `#include "chapter.typ"`, its content in place, as a book's main file pulls in its
 * chapters (a drop edit provider; extensions with Typst files of their own make something else of them by priority:
 * a spreadsheet's `.ic.gen.typ`).
 *
 * The Source editor and the raw boxes are plain CodeMirror hosts, colored by the Source editor host's `codeColors`;
 * that their text is Typst is contributed here once for both. Errors come from the compiler only (the diagnostics
 * extension), not from the syntax: see `typstSyntax`. See docs/40_architecture/05_source-editor.typ.
 */
export function typstLanguage(): TypstExtension {
  return {
    id: 'typst-language',
    activate({ sourceEditor, visualEditor, languages, subscriptions }) {
      const syntax = typstSyntax();
      subscriptions.push(
        sourceEditor.registerCodeMirrorExtension(syntax),
        visualEditor.registerRawBoxCodeMirrorExtension(() => syntax),
        languages.registerHelpProvider({ language: 'typst' }, { provideHelp: () => TYPST_HELP }),
        languages.registerDocumentDropEditProvider({ language: 'typst' }, includeDrops),
      );
    },
  };
}

/** A Typst file dropped into another: `#include "path"` (never into itself: Typst would include it forever). */
const includeDrops: DocumentDropEditProvider = {
  provideDocumentDropEdits: ({ path }, _position, file) =>
    ProjectPath.isTypst(file) && file !== path ? { insertText: `#include ${quote(ProjectPath.referenceTo(path, file))}` } : null,
};
