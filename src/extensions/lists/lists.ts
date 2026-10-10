// The lists extension: bulleted, numbered and task lists in the Visual view, with their toolbar buttons. See
// ARCHITECTURE.md, "VisualView". Why one extension: a task list is a bullet list in Typst (`- [ ] todo`), so the two
// share their syntax, their toolbar group and the order in which their projectors are asked.
import type { TypstExtension } from '../../hosts/workbench/workbench';
import {
  BULLET_LIST, LIST_ACTIONS, LIST_ITEM, ORDERED_LIST, TASK_ITEM, TASK_LIST, TASK_LIST_ACTION,
} from './visual-view/visual-view';

/** Bulleted, numbered and task lists. */
export const lists: TypstExtension = {
  id: 'lists',
  activate({ visualView, subscriptions }) {
    subscriptions.push(
      // task lists first: projectors of the same syntax are asked in registration order, and a task item is a bullet
      // item (`- [ ] ..`)
      visualView.registerNode(TASK_LIST),
      visualView.registerNode(TASK_ITEM),
      visualView.registerNode(BULLET_LIST),
      visualView.registerNode(ORDERED_LIST),
      visualView.registerNode(LIST_ITEM),
      visualView.registerToolbarGroup({ kind: 'group', id: 'lists', order: 30 }),
      ...[...LIST_ACTIONS, TASK_LIST_ACTION].map((action, i) => visualView.registerToolbarItem({ group: 'lists', order: 10 * (i + 1), action })),
    );
  },
};
