// The lists extension: bulleted, numbered and task lists in the Visual view, with their toolbar buttons. See
// ARCHITECTURE.md, "VisualView". Why one extension: a task list is a bullet list in Typst (`- [ ] todo`), so the two
// share their syntax and their toolbar group; task lists' priority puts their projectors first.
import type { TypstExtension } from '../../hosts/workbench/workbench';
import css from './lists.css?inline';
import {
  BULLET_LIST, LIST_ACTIONS, LIST_ITEM, ORDERED_LIST, TASK_ITEM, TASK_LIST, TASK_LIST_ACTION,
} from './visual-view/visual-view';

/** Task lists' priority over bullet lists (default 100), whose syntax they share. */
const TASK_LISTS_PRIORITY = 110;

/** Bulleted, numbered and task lists. */
export const lists: TypstExtension = {
  id: 'lists',
  activate({ workbench, visualView, subscriptions }) {
    subscriptions.push(workbench.registerStyleSheet(css));
    subscriptions.push(
      visualView.registerNode(BULLET_LIST),
      visualView.registerNode(ORDERED_LIST),
      visualView.registerNode(LIST_ITEM),
      // a task item is a bullet item (`- [ ] ..`): its projector is asked before the bullet list's
      visualView.registerNode(TASK_LIST, { priority: TASK_LISTS_PRIORITY }),
      visualView.registerNode(TASK_ITEM, { priority: TASK_LISTS_PRIORITY }),
      visualView.registerToolbarGroup({ kind: 'group', id: 'lists', order: 30 }),
      ...[...LIST_ACTIONS, TASK_LIST_ACTION].map((action, i) => visualView.registerToolbarItem({ group: 'lists', order: 10 * (i + 1), action })),
    );
  },
};
