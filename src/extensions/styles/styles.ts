// The styles extension: the paragraph and text styles a project declares (`/// @style …`), in the Visual view.
// Entry of extensions/styles/. Why an extension: a style is a Typst function declared in some file of the project,
// never a registry of the editor's own, so one read model (StyleIndex, the `styles` service) follows the whole
// project, and every document's Visual view shows the styles' calls as styled text and applies them from the text
// style menu, importing a style where it is used. See ARCHITECTURE.md, "Custom styles".
import type { Project } from '../../core/project/project';
import type { TypstExtension, Workbench } from '../../hosts/workbench/workbench';
import { newStyle, StyleIndex } from './model/model';
import { customStyles } from './visual-view/visual-view';

declare module '../../hosts/workbench/workbench' {
  interface ServiceRegistry {
    /** The custom styles the project declares (the styles extension). */
    styles: StyleIndex;
  }
}

/**
 * Keeps the project's custom styles indexed (the `styles` service); every document's Visual view shows and applies
 * them and offers "New style…".
 */
export function styles(): TypstExtension {
  return {
    id: 'styles',
    activate(context) {
      const { project, workbench, services, subscriptions } = context;
      const index = new StyleIndex(project);
      subscriptions.push(index, services.provide('styles', index));
      customStyles({ styles: index, create: () => void addNewStyle(index, project, workbench) }).activate(context);
    },
  };
}

/**
 * "New style…": appends a paragraph style to start from to the file holding most styles (else
 * `/styles.typ`, created when missing) and shows it in the Source view.
 */
async function addNewStyle(index: StyleIndex, project: Project, workbench: Workbench): Promise<void> {
  const path = index.homeFile();
  const file = project.document(path);
  const added = newStyle(file?.text ?? '');
  if (file) file.change([{ from: file.text.length, to: file.text.length, insert: added.text.slice(file.text.length) }], 'new-style');
  else if ((await workbench.applyChange({ kind: 'create', path, content: added.text })) !== null) return;
  workbench.open(path, { selection: { from: added.from, to: added.to }, mode: 'source' });
}
