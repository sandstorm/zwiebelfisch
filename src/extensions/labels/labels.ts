import type { Extension } from '../../hosts/workbench/workbench';
import css from './labels.css?inline';
import { LabelIndex } from './model/label-index';
import { renamePastedLabels } from './model/pasted-labels';
import { registerReferences } from './visual-editor/visual-editor';
import { LabelLinks } from './workbench/label-links';
import { labelSearch } from './workbench/label-search';

/**
 * Labels (`<intro>`) and the references to them (`@intro`), across the whole project.
 * In every Visual editor:
 * - references show as chips that say what they point to, or that the label is missing
 * - labels show as tags on their blocks, to rename (with every reference) or remove
 * - `@` lists the labels
 *
 * Also: "Labels" in search everywhere; references and `#link(<label>)` as document links to their label in every
 * editor; a pasted label the project has already gets a new name (`<fig:setup-1>`), and so do the references to it in
 * the pasted text, so a paste never makes two labels of one name.
 */
export function labels(): Extension {
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
        registerReferences(context.visualEditor, { labels: index, prompts: context.window }),
      );
    },
  };
}
