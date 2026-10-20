import type { Extension } from '../../hosts/workbench/workbench';
import css from './lists.css?inline';
import { registerChainButton } from '../../hosts/visual-editor/visual-editor';
import { BULLET_LIST, LIST_BUTTONS, LIST_ITEM, ORDERED_LIST } from './visual-editor/visual-editor';
import { TASK_ITEM, TASK_LIST, TASK_LIST_BUTTON } from './visual-editor/task-lists';

/**
 * Bulleted, numbered and task lists in the Visual editor, with their toolbar buttons.
 * An edit that adds a task item (`- [ ] todo`) also adds the import and show rule of the package cheq if they are
 * missing, since Typst draws the boxes only with it.
 */
export function lists(): Extension {
  return {
    id: 'lists',
    activate(context) {
      const { window, visualEditor, subscriptions } = context;
      subscriptions.push(window.registerStyleSheet(css));
      subscriptions.push(
        visualEditor.registerNode(BULLET_LIST),
        visualEditor.registerNode(ORDERED_LIST),
        visualEditor.registerNode(LIST_ITEM),
        visualEditor.registerNode(TASK_LIST),
        visualEditor.registerNode(TASK_ITEM),
        ...[...LIST_BUTTONS, TASK_LIST_BUTTON].map((button) => registerChainButton(context, 'visualEditor/toolbar', button)),
      );
    },
  };
}
