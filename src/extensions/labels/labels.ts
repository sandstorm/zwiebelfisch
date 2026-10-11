// The labels extension: the project's labels and the references to them, in the Visual editor. Entry of
// extensions/labels/. Why an extension: Typst labels (`<intro>`) and references (`@intro`) span files, so one
// read model (LabelIndex) follows the whole project, and every document's Visual editor shows
// references as chips with what they point to, labels as tags, and offers the labels after `@`; search everywhere
// finds them too. See docs/10_guide/02_features.typ.
import type { TypstExtension } from '../../hosts/workbench/workbench';
import css from './labels.css?inline';
import { LabelIndex } from './model/label-index';
import { references } from './visual-editor/visual-editor';
import { labelSearch } from './workbench/label-search';

/** Keeps the project's labels indexed and contributes references and labels to the Visual editor. */
export function labels(): TypstExtension {
  return {
    id: 'labels',
    activate(context) {
      context.subscriptions.push(context.workbench.registerStyleSheet(css));
      const index = new LabelIndex(context.project);
      context.subscriptions.push(index, context.window.registerSearchProvider(labelSearch(index, context.project, context.workbench)));
      references({ labels: index, prompts: context.window }).activate(context);
    },
  };
}
