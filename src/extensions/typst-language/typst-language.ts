// The typst-language extension. Entry of extensions/typst-language/. See
// docs/30_architecture/08_built-in-extensions.typ.
import type { TypstExtension } from '../../hosts/workbench/workbench';
import { codeColors } from './source-editor/code-colors';
import { typstSyntax } from './source-editor/typst-syntax';

/**
 * Typst syntax and its highlighting, in CodeMirror's light or dark theme, in the Source editors and raw boxes.
 *
 * Typst syntax highlighting and indentation, and code colors following the widget's color scheme, in every Source
 * editor and in the code of the Visual editor's raw boxes.
 *
 * Why an extension: the editors are hosts for any CodeMirror language; that it is Typst, and how it is colored, is
 * contributed here, once for both editors.
 */
export function typstLanguage(): TypstExtension {
  return {
    id: 'typst-language',
    activate({ sourceEditor, visualEditor, subscriptions }) {
      const syntax = typstSyntax();
      subscriptions.push(
        sourceEditor.registerCodeMirrorExtension(codeColors),
        sourceEditor.registerCodeMirrorExtension(syntax),
        visualEditor.registerRawBoxCodeMirrorExtension(() => [syntax, codeColors]),
      );
    },
  };
}
