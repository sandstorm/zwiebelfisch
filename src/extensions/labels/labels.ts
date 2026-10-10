// The labels extension: the project's labels and the references to them, in the Visual view. Entry of
// extensions/labels/. Why an extension: Typst labels (`<intro>`) and references (`@intro`) span files, so one
// read model (LabelIndex, the `labels` service) follows the whole project, and every document's Visual view shows
// references as chips with what they point to, labels as tags, and offers the labels after `@`.
// See ARCHITECTURE.md, "Labels and references".
import type { TypstExtension } from '../../hosts/workbench/workbench';
import css from './labels.css?inline';
import { LabelIndex } from './model/model';
import { references } from './visual-view/visual-view';

declare module '../../hosts/workbench/workbench' {
  interface ServiceRegistry {
    /** The project's labels and the references to them (the labels extension). */
    labels: LabelIndex;
  }
}

/** Keeps the project's labels indexed (the `labels` service) and contributes references and labels to the Visual view. */
export function labels(): TypstExtension {
  return {
    id: 'labels',
    activate(context) {
      context.subscriptions.push(context.workbench.registerStyleSheet(css));
      const index = new LabelIndex(context.project);
      context.subscriptions.push(index, context.services.provide('labels', index));
      references({ labels: index }).activate(context);
    },
  };
}
