// The project's custom styles in search everywhere: applied to the selection. See ../styles.ts and
// docs/10_guide/02_features.typ.
import { ProjectPath } from '../../../core/paths/paths';
import type { TextChange } from '../../../core/typst-document/typst-document';
import { VISUAL_VIEW_TYPE } from '../../../hosts/visual-view/visual-view';
import type { SearchProvider, TextEditor, WindowApi } from '../../../hosts/window/window';
import type { TypstStyle } from '../model/discover';
import { calculateStyleWrap } from '../model/style-wrap';
import type { ProjectStyles } from '../model/typst-style-index';
import type { StyleApplier } from '../visual-view/visual-view';

/** The origin of a style applied in the Source view. */
const STYLE_APPLY = 'style-apply';

/**
 * "Styles" (prefix `*`): the project's block and inline styles; picking one applies it to the selection of the Typst
 * editor in use: in the Visual view as its text style menu does, in the Source view as text (`#name[selection]`, an
 * empty call at a caret), importing the style where needed. Without a Typst editor, or where the style cannot apply,
 * a message says so.
 */
export function styleSearch(styles: ProjectStyles, applier: Pick<StyleApplier, 'apply'>, window: Pick<WindowApi, 'activeTextEditor' | 'showInformationMessage'>): SearchProvider {
  const apply = (style: TypstStyle) => {
    const editor = window.activeTextEditor;
    const applied = editor && (editor.viewType === VISUAL_VIEW_TYPE ? applier.apply(editor.document, style) : wrapInSource(editor, style, styles));
    if (!applied) void window.showInformationMessage(`${style.label} cannot be applied here: select text in a Typst file.`);
  };
  return {
    id: 'styles.styles',
    label: 'Styles',
    prefix: '*',
    order: 50,
    provideItems: () =>
      styles.styles().map((style) => ({
        label: style.label,
        description: `${style.kind === 'block' ? 'Block' : 'Inline'} style · ${ProjectPath.displayName(style.path)}`,
        accept: () => apply(style),
      })),
  };
}

/** Wraps the Source view's selection in the style's call, with the import, and selects the wrapped text. */
function wrapInSource(editor: TextEditor, style: TypstStyle, styles: ProjectStyles): boolean {
  const { document, selection } = editor;
  const imported = styles.calculateImportChange(document, style, selection.from);
  const wrap = calculateStyleWrap(style.name, selection, imported && imported.from <= selection.from ? added(imported) : 0);
  document.change(imported ? [imported, ...wrap.changes] : wrap.changes, STYLE_APPLY);
  editor.revealRange(wrap.content);
  return true;
}

/** How many characters `change` adds. */
function added(change: TextChange): number {
  return change.insert.length - (change.to - change.from);
}
