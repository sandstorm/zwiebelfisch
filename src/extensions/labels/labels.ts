import type { TypstExtension } from '../../hosts/workbench/workbench';
import css from './labels.css?inline';
import { LabelIndex } from './model/label-index';
import { renamePastedLabels } from './model/pasted-labels';
import { references } from './visual-editor/visual-editor';
import { LabelLinks } from './workbench/label-links';
import { labelSearch } from './workbench/label-search';

/**
 * Labels and the references to them, across the whole project.
 *
 * A label (`<intro>`) and the references to it (`@intro`) are often in different files. So one LabelIndex reads every
 * `.typ` and `.bib` file of the project and follows each change. Every Visual editor uses it: references show as chips
 * that say what they point to (or that the label is missing), labels as tags on their blocks (rename with every
 * reference, or remove), and `@` lists the labels. Search everywhere lists them as "Labels". References and
 * `#link(<label>)` are document links to their label, in every editor (⌘/Ctrl+click or Alt+Enter). A label pasted
 * (in either editor) that the project has already gets a new name (`<fig:setup-1>`), and so do the references to it
 * in the pasted text: a copy never makes two labels of one name (a paste edit provider resolving every paste).
 *
 * The text stays plain Typst; chips and tags are only how the Visual editor draws it. Figures' labels are searched
 * through the figures extension, by caption. See docs/20_features/03_writing.typ.
 */
export function labels(): TypstExtension {
  return {
    id: 'labels',
    activate(context) {
      context.subscriptions.push(context.workbench.registerStyleSheet(css));
      const index = new LabelIndex(context.project);
      context.subscriptions.push(
        index,
        context.window.registerSearchProvider(labelSearch(index, context.project, context.workbench)),
        context.languages.registerDocumentLinkProvider({ language: 'typst' }, new LabelLinks(index, context.project)),
        context.languages.registerDocumentPasteEditProvider(
          { language: 'typst' },
          { resolveDocumentPasteEdit: (edit, document, ranges) => ({ ...edit, insertText: renamePastedLabels(edit.insertText, document, ranges, index.labels()) }) },
          { providedPasteEditKinds: [] },
        ),
      );
      references({ labels: index, prompts: context.window }).activate(context);
    },
  };
}
