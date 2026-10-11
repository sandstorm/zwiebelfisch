// The styles extension: the paragraph and text styles a project declares (`/// @style …`), in the Visual view.
// Entry of extensions/styles/. Why an extension: a style is a Typst function declared in some file of the project,
// never a registry of the editor's own, so one read model (StyleIndex) follows the whole
// project, and every document's Visual view shows the styles' calls as styled text and applies them from the text
// style menu, importing a style where it is used. See ARCHITECTURE.md, "Custom styles".
import type { ExtensionContext, TypstExtension } from '../../hosts/workbench/workbench';
import css from './styles.css?inline';
import { calculateNewStyleChange } from './model/new-style';
import { StyleIndex } from './model/style-index';
import { customStyles } from './visual-view/visual-view';

/**
 * Keeps the project's custom styles indexed; every document's Visual view shows and applies
 * them and offers "New style…".
 */
export function styles(): TypstExtension {
  return {
    id: 'styles',
    activate(context) {
      context.subscriptions.push(context.workbench.registerStyleSheet(css));
      const index = new StyleIndex(context.project);
      context.subscriptions.push(index);
      customStyles({ styles: index, create: () => void addNewStyle(index, context) }).activate(context);
    },
  };
}

/**
 * "New style…": asks for the style's name, appends a paragraph style of that name to start from to the file holding
 * most styles (else `/styles.typ`, created when missing; a refusal is an error message) and shows it in the Source
 * view.
 */
async function addNewStyle(index: StyleIndex, { project, window, workspace, workbench }: ExtensionContext): Promise<void> {
  const label = await window.showInputBox({
    title: 'New style',
    prompt: 'Name of the paragraph style',
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
  workbench.open(path, { selection: definition, mode: 'source' });
}
