import type { TypstExtension } from '../../hosts/workbench/workbench';
import css from './lists.css?inline';
import { BULLET_LIST, LIST_ACTIONS, LIST_ITEM, ORDERED_LIST } from './visual-editor/visual-editor';
import { TASK_ITEM, TASK_LIST, TASK_LIST_ACTION } from './visual-editor/task-lists';

/**
 * Bulleted, numbered and task lists in the Visual editor, with their toolbar buttons.
 *
 * A task item is a bullet item in Typst (`- [ ] todo`), so all lists live in one extension and share a toolbar group.
 * Task lists get a higher Tiptap priority, so their parse rule claims those items before bullet lists do. Typst draws
 * the boxes only with the Universe package cheq: an edit that adds a task item also adds cheq's import and show rule
 * if they are missing (model/checklist-preamble.ts). See docs/30_architecture/08_built-in-extensions.typ.
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
