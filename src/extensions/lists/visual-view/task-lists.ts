// Task lists (checklists, rendered by the cheq package): `- [ ] todo` / `- [x] done`. See visual-view.ts.
import { Extension } from '@tiptap/core';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import type { SyntaxNode } from '@lezer/common';
import type { Node } from '@tiptap/pm/model';
import { Plugin } from '@tiptap/pm/state';
import { children } from '../../../core/typst-syntax/typst-syntax';
import { svg, type ToolbarAction, type TypstNodeSpec } from '../../../hosts/visual-view/visual-view';
import type { TypstParseContext } from '../../../hosts/projection/projection';
import { countTaskItems, ensureChecklistPreamble } from './checklist-preamble';

/**
 * Task lists' Tiptap priority, over bullet lists (default 100), whose syntax they share: a task item is a bullet item
 * (`- [ ] ..`), so its parse rule is asked before the bullet list's.
 */
const TASK_LISTS_PRIORITY = 110;

const TypstTaskList = TaskList.extend({
  priority: TASK_LISTS_PRIORITY,
  addAttributes() {
    return { ...this.parent?.(), sep: { default: null, rendered: false } };
  },
});

const TypstTaskItem = TaskItem.extend({
  priority: TASK_LISTS_PRIORITY,
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
  addExtensions: () => [TypstTaskList.configure({ HTMLAttributes: { class: 'typst-lists__tasks' } }), TypstTaskItem, ChecklistPreamble],
});

/**
 * Task lists: a bullet item `- [ ] text` / `- [x] text` (one paragraph) is a
 * task item, the box hidden syntax; consecutive ones form a task list.
 * Tiptap's TaskList / TaskItem (one paragraph, no nesting; the `[ ] ` input
 * rule and clickable checkboxes are Tiptap's). Their Tiptap priority is higher
 * than bullet lists' (`TASK_LISTS_PRIORITY`), so their parse rule gets bullet items first.
 */
export const TASK_LIST: TypstNodeSpec = {
  name: 'taskList',
  tiptap: TaskLists,
  typst: { toTypst: (state, list, pos) => state.blocks(list, pos + 1, '\n') },
};

export const TASK_ITEM: TypstNodeSpec = {
  name: 'taskItem',
  typst: {
    parseTypst: { syntaxNodes: { ListItem: { block: parseTaskItem, standsAlone: true } } },
    toTypst: (state, item, pos) => state.item(item, pos, `- [${item.attrs.checked ? 'x' : ' '}] `),
    anchors: ['marker'],
    container: () => 'taskList',
  },
};

/** cheq's unchecked and checked boxes; others (`[/]`, `[-]`, …) stay text. */
const TASK_BOX = /^\[([ x])\](?: |$)/;

/** `- [ ] text` / `- [x] text` (one paragraph, a space after the box): a task item; null for other bullet items. */
function parseTaskItem(p: TypstParseContext, node: SyntaxNode, sep: string | null): Node | null {
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

/** "Task list", after the other lists in the toolbar's `lists` group. */
export const TASK_LIST_ACTION: ToolbarAction = {
  label: 'Task list',
  shortcut: 'Mod+Shift+9',
  icon: ICON,
  run: (c) => c.toggleTaskList(),
  active: (e) => e.isActive('taskList'),
};
