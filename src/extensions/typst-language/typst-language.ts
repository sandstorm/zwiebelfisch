import type { TypstExtension } from '../../hosts/workbench/workbench';
import { typstSyntax } from './source-editor/typst-syntax';
import { TYPST_HELP } from './workbench/typst-help';

/**
 * Typst as a language for CodeMirror: highlighting and indentation. It goes into every Source editor and into the code
 * of the Visual editor's raw boxes. The help sheet "Typst basics" is here too.
 *
 * The Source editor and the raw boxes are plain CodeMirror hosts, colored by the Source editor host's `codeColors`;
 * that their text is Typst is contributed here once for both. Errors come from the compiler only (the diagnostics
 * extension), not from the syntax: see `typstSyntax`. See docs/30_architecture/05_source-editor.typ.
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
      );
    },
  };
}
