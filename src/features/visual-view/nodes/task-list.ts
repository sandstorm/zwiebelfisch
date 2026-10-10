import { Extension } from '@tiptap/core';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Plugin } from '@tiptap/pm/state';
import { countTaskItems, ensureChecklistPreamble } from './checklist-preamble';

/**
 * Task lists: `- [ ] todo` / `- [x] done` bullet items (rendered as
 * checkboxes by the cheq package). Tiptap's TaskList / TaskItem with the
 * source anchors of a list item; a task item holds one paragraph (no
 * nesting). The `[ ] ` input rule and clickable checkboxes come from Tiptap.
 */
export const TypstTaskList = TaskList.extend({
  addAttributes() {
    return { ...this.parent?.(), sep: { default: null, rendered: false } };
  },
});

export const TypstTaskItem = TaskItem.extend({
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
export const ChecklistPreamble = Extension.create({
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
