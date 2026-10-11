import type { TypstExtension } from '../../hosts/workbench/workbench';
import { codeColors } from './source-editor/code-colors';
import { typstSyntax } from './source-editor/typst-syntax';
import { TYPST_HELP } from './workbench/typst-help';

/**
 * Typst as a language for CodeMirror: highlighting and indentation, with code colors that follow the widget's light or
 * dark scheme. It goes into every Source editor and into the code of the Visual editor's raw boxes. The help sheet
 * "Typst basics" is here too.
 *
 * The Source editor and the raw boxes are plain CodeMirror hosts; that their text is Typst, and how it is colored, is
 * contributed here once for both. Errors come from the compiler only (the diagnostics extension), not from the
 * syntax: see `typstSyntax`. See docs/30_architecture/05_source-editor.typ.
 */
export function typstLanguage(): TypstExtension {
  return {
    id: 'typst-language',
    activate({ sourceEditor, visualEditor, languages, subscriptions }) {
      const syntax = typstSyntax();
      subscriptions.push(
        sourceEditor.registerCodeMirrorExtension(codeColors),
        sourceEditor.registerCodeMirrorExtension(syntax),
        visualEditor.registerRawBoxCodeMirrorExtension(() => [syntax, codeColors]),
        languages.registerHelpProvider({ language: 'typst' }, { provideHelp: () => TYPST_HELP }),
      );
    },
  };
}
