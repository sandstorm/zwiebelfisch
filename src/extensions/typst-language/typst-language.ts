// The typst-language extension: Typst syntax highlighting and indentation, and code colors following the widget's
// color scheme, in every Source view and in the code of the Visual view's raw boxes.
// Entry of extensions/typst-language/. See ARCHITECTURE.md, "SourceView".
// Why an extension: the editors are hosts for any CodeMirror language; that it is Typst, and how it is colored,
// is contributed here, once for both views.
import type { TypstExtension } from '../../hosts/workbench/workbench';
import { codeColors } from './source-view/code-colors';
import { typstSyntax } from './source-view/typst-syntax';

/** Typst syntax and its highlighting, in CodeMirror's light or dark theme, in the Source views and raw boxes. */
export function typstLanguage(): TypstExtension {
  return {
    id: 'typst-language',
    activate({ sourceView, visualView, subscriptions }) {
      const syntax = typstSyntax();
      subscriptions.push(
        sourceView.registerCodeMirrorExtension(codeColors),
        sourceView.registerCodeMirrorExtension(syntax),
        visualView.registerRawBoxCodeMirrorExtension(() => [syntax, codeColors]),
      );
    },
  };
}
