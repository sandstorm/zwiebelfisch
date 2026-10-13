import { SOURCE_EDITOR } from '../../hosts/source-editor/source-editor';
import type { ExtensionContext, Extension } from '../../hosts/workbench/workbench';
import css from './styles.css?inline';
import { calculateNewStyleChange } from './model/new-style';
import { TypstStyleIndex } from './model/typst-style-index';
import { customStyles, styleApplier } from './visual-editor/visual-editor';
import { styleSearch } from './workbench/style-search';

/**
 * The custom block and inline styles a project declares (`/// @style …` above a Typst function).
 *
 * A style is a Typst function in some file of the project, not something the editor keeps. So one TypstStyleIndex
 * reads every Typst file and follows each change. Every Visual editor shows the styles' calls as styled text and
 * applies them from the text style menu, importing a style where it is used; "New style…" there adds a block style to
 * start from and shows it in the Source editor. Search everywhere ("Styles") applies a style in either editor.
 *
 * Calls of functions not declared as styles stay raw boxes. See docs/20_features/06_custom-styles.typ.
 */
export function styles(): Extension {
  return {
    id: 'styles',
    activate(context) {
      context.subscriptions.push(context.workbench.registerStyleSheet(css));
      const index = new TypstStyleIndex(context.project);
      context.subscriptions.push(index);
      customStyles({ styles: index, create: () => void addNewStyle(index, context) }).activate(context);
      const applier = styleApplier(index);
      applier.activate(context);
      context.subscriptions.push(context.window.registerSearchProvider(styleSearch(index, applier, context.window)));
    },
  };
}

/**
 * "New style…": asks for the style's name, appends a block style of that name to start from to the file holding
 * most styles (else `/styles.typ`, created when missing; a refusal is an error message) and shows it in the Source
 * editor.
 */
async function addNewStyle(index: TypstStyleIndex, { project, window, workspace, workbench }: ExtensionContext): Promise<void> {
  const label = await window.showInputBox({
    title: 'New style',
    prompt: 'Name of the block style',
    value: 'New style',
    validateInput: (value) => (value.trim() === '' ? 'Enter a name.' : null),
  });
  if (label === undefined) return;
  const path = index.homeFile();
  const file = project.document(path);
  const { change, definition } = calculateNewStyleChange(file?.text ?? '', label.trim());
  if (file) file.change([change], 'new-style');
  else {
    const problem = await workspace.applyEdit({ kind: 'create', path, content: change.insert });
    if (problem !== null) return void window.showErrorMessage(`The style was not added: ${problem}`);
  }
  workbench.open(path, { selection: definition, viewType: SOURCE_EDITOR });
}
