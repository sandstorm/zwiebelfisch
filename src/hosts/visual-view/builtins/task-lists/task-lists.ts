// Task lists (checklists, rendered by the cheq package): `- [ ] todo` / `- [x] done`. Entry of
// visual-view/builtins/task-lists/. See ARCHITECTURE.md, "VisualView".
import { Extension } from '@tiptap/core';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import type { SyntaxNode } from '@lezer/common';
import type { Node } from '@tiptap/pm/model';
import { Plugin } from '@tiptap/pm/state';
import { svg, type TypstNodeSpec, type VisualViewContribution } from '../../contributions/contributions';
import { children, type ProjectionContext } from '../../projection/projection';
import { countTaskItems, ensureChecklistPreamble } from './checklist-preamble';

export { CHECKLIST_PREAMBLE, ensureChecklistPreamble } from './checklist-preamble';

/**
 * Task lists: a bullet item `- [ ] text` / `- [x] text` (one paragraph) is a
 * task item, the box hidden syntax; consecutive ones form a task list.
 * Tiptap's TaskList / TaskItem (one paragraph, no nesting; the `[ ] ` input
 * rule and clickable checkboxes are Tiptap's), and the "Task list" button.
 * Registered before `lists`: its projector gets bullet items first.
 */
export const taskLists: VisualViewContribution = {
  id: 'task-lists',
  activate({ visualView, subscriptions }) {
    subscriptions.push(
      visualView.registerNode(TASK_LIST),
      visualView.registerNode(TASK_ITEM),
      visualView.registerToolbarItem({
        group: 'lists',
        order: 30,
        action: { label: 'Task list', shortcut: 'Mod+Shift+9', icon: ICON, run: (c) => c.toggleTaskList(), active: (e) => e.isActive('taskList') },
      }),
    );
  },
};

const TypstTaskList = TaskList.extend({
  addAttributes() {
    return { ...this.parent?.(), sep: { default: null, rendered: false } };
  },
});

const TypstTaskItem = TaskItem.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      src: { default: null, rendered: false, keepOnSplit: false },
      sep: { default: null, rendered: false },
      marker: { default: null, rendered: false, keepOnSplit: false },
    };
  },
});

/**
 * Whenever an edit in the Visual view adds a task item, the document gets
 * cheq's import and show rule if it lacks them (in the same undo step).
 * Changes that come from the source are left alone.
 */
const ChecklistPreamble = Extension.create({
  name: 'typstChecklistPreamble',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction(transactions, oldState, newState) {
          const edited = transactions.some((tr) => tr.docChanged && tr.getMeta('addToHistory') !== false);
          if (!edited || countTaskItems(newState.doc) <= countTaskItems(oldState.doc)) return null;
          const tr = newState.tr;
          ensureChecklistPreamble(tr);
          return tr.docChanged ? tr : null;
        },
      }),
    ];
  },
});

const TaskLists = Extension.create({
  name: 'typstTaskLists',
  addExtensions: () => [TypstTaskList, TypstTaskItem, ChecklistPreamble],
});

const TASK_LIST: TypstNodeSpec = {
  name: 'taskList',
  extension: TaskLists,
  print: (out, list, pos) => out.blocks(list, pos + 1, '\n'),
};

const TASK_ITEM: TypstNodeSpec = {
  name: 'taskItem',
  anchors: ['marker'],
  container: () => 'taskList',
  blockSyntax: { ListItem: { project: taskItem } },
  print: (out, item, pos) => out.item(item, pos, `- [${item.attrs.checked ? 'x' : ' '}] `),
};

/** cheq's unchecked and checked boxes; others (`[/]`, `[-]`, …) stay text. */
const TASK_BOX = /^\[([ x])\](?: |$)/;

/** `- [ ] text` / `- [x] text` (one paragraph, a space after the box): a task item; null for other bullet items. */
function taskItem(p: ProjectionContext, node: SyntaxNode, sep: string | null): Node | null {
  const markup = node.getChild('Markup');
  const box = markup ? TASK_BOX.exec(p.text(markup)) : null;
  if (!markup || !box) return null;
  const body = children(markup).filter((n) => n.from >= markup.from + box[0].length);
  if (!p.isOneParagraph(body)) return null;
  const from = markup.from + box[0].length;
  const paragraph = p.textblock({ type: 'paragraph', attrs: { src: p.source.slice(from, markup.to) } }, from, p.inline(body));
  const attrs = { marker: '-', checked: box[1] === 'x', src: p.text(node), sep };
  return p.pristine('taskItem', attrs, [paragraph]);
}

const ICON = svg('<rect x="3" y="5" width="6" height="6" rx="1"/><path d="m4.5 8 1 1 2-2"/><rect x="3" y="14" width="6" height="6" rx="1"/><path d="M13 8h8M13 17h8"/>');
