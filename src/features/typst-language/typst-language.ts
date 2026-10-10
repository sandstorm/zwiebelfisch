// The typst-language extension: Typst syntax highlighting and the colors of color values in every Source view.
// Entry of features/typst-language/. See ARCHITECTURE.md, "SourceView".
import { codeColors, typstLanguage as typstSyntax } from '../../hosts/source-view/source-view';
import type { TypstExtension } from '../../hosts/workbench/workbench';

/** Typst syntax and its highlighting, and a swatch next to each color value, in the Source views. */
export function typstLanguage(): TypstExtension {
  return {
    id: 'typst-language',
    activate({ sourceView, subscriptions }) {
      subscriptions.push(sourceView.registerExtension(codeColors), sourceView.registerExtension(typstSyntax()));
    },
  };
}
