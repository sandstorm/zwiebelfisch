// The lists extension. See docs/30_architecture/08_built-in-extensions.typ.
import type { TypstExtension } from '../../hosts/workbench/workbench';
import css from './lists.css?inline';
import { BULLET_LIST, LIST_ACTIONS, LIST_ITEM, ORDERED_LIST } from './visual-editor/visual-editor';
import { TASK_ITEM, TASK_LIST, TASK_LIST_ACTION } from './visual-editor/task-lists';

/**
 * Bulleted, numbered and task lists.
 *
 * Bulleted, numbered and task lists in the Visual editor, with their toolbar buttons. Why one extension: a task list is
 * a bullet list in Typst (`- [ ] todo`), so the two share their syntax and their toolbar group; task lists' Tiptap
 * priority puts their parse rule first.
 */
export function lists(): TypstExtension {
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
