import type { Extension } from '../../hosts/workbench/workbench';
import css from './lists.css?inline';
import { BULLET_LIST, LIST_ACTIONS, LIST_ITEM, ORDERED_LIST } from './visual-editor/visual-editor';
import { TASK_ITEM, TASK_LIST, TASK_LIST_ACTION } from './visual-editor/task-lists';

/**
 * Bulleted, numbered and task lists in the Visual editor, with their toolbar buttons.
 * An edit that adds a task item (`- [ ] todo`) also adds the import and show rule of the package cheq if they are
 * missing, since Typst draws the boxes only with it.
 */
export function lists(): Extension {
  return {
    id: 'lists',
    activate({ workbench, visualEditor, subscriptions }) {
      subscriptions.push(workbench.registerStyleSheet(css));
      subscriptions.push(
        visualEditor.registerNode(BULLET_LIST),
        visualEditor.registerNode(ORDERED_LIST),
        visualEditor.registerNode(LIST_ITEM),
        visualEditor.registerNode(TASK_LIST),
        visualEditor.registerNode(TASK_ITEM),
        visualEditor.registerToolbarGroup({ kind: 'group', id: 'lists', order: 30 }),
        ...[...LIST_ACTIONS, TASK_LIST_ACTION].map((action, i) => visualEditor.registerToolbarItem({ group: 'lists', order: 10 * (i + 1), action })),
      );
    },
  };
}
