// The lists extension: bulleted, numbered and task lists in the Visual view, with their toolbar buttons. See
// ARCHITECTURE.md, "VisualView". Why one extension: a task list is a bullet list in Typst (`- [ ] todo`), so the two
// share their syntax and their toolbar group; task lists' Tiptap priority puts their parse rule first.
import type { TypstExtension } from '../../hosts/workbench/workbench';
import css from './lists.css?inline';
import { BULLET_LIST, LIST_ACTIONS, LIST_ITEM, ORDERED_LIST } from './visual-view/visual-view';
import { TASK_ITEM, TASK_LIST, TASK_LIST_ACTION } from './visual-view/task-lists';

/** Bulleted, numbered and task lists. */
export function lists(): TypstExtension {
  return {
    id: 'lists',
    activate({ workbench, visualView, subscriptions }) {
      subscriptions.push(workbench.registerStyleSheet(css));
      subscriptions.push(
        visualView.registerNode(BULLET_LIST),
        visualView.registerNode(ORDERED_LIST),
        visualView.registerNode(LIST_ITEM),
        visualView.registerNode(TASK_LIST),
        visualView.registerNode(TASK_ITEM),
        visualView.registerToolbarGroup({ kind: 'group', id: 'lists', order: 30 }),
        ...[...LIST_ACTIONS, TASK_LIST_ACTION].map((action, i) => visualView.registerToolbarItem({ group: 'lists', order: 10 * (i + 1), action })),
      );
    },
  };
}
