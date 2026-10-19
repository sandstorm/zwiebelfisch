import { ProjectPath } from '../../core/paths/paths';
import { quote } from '../../core/typst-syntax/typst-syntax';
import type { DocumentDropEditProvider } from '../../hosts/languages/languages';
import type { Extension } from '../../hosts/workbench/workbench';
import { typstSyntax } from './source-editor/typst-syntax';
import { TYPST_HELP } from './workbench/typst-help';

/**
 * Typst as a language, used by:
 * - every Source editor and the code of the Visual editor's raw boxes: highlighting and indentation
 * - the help sheet "Typst basics"
 * - a Typst file dropped from the file panel into another: `#include "chapter.typ"`
 *
 * The syntax reports no errors, so each error is shown once, from the compiler.
 */
export function typstLanguage(): Extension {
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
