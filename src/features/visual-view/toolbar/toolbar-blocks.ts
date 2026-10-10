import { findParentNode, type Editor } from '@tiptap/core';
import { hasHeadingNumbering } from '../nodes/heading-numbering';
import { svg, type Action } from './toolbar-action';

/**
 * Toolbar entries for the block nodes modelled on Tiptap's (page break,
 * horizontal rule, …), kept apart from `toolbar.ts` so each node's entry
 * lives next to the others of its kind.
 */
const ICONS = {
  pageBreak: svg('<path d="M6 3v5h12V3"/><path d="M6 21v-5h12v5"/><path d="M3 12h2M8 12h2M14 12h2M19 12h2"/>'),
  rule: svg('<path d="M3 12h18"/>'),
  headerRow: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M4 7h16" stroke-width="4"/>'),
  taskList: svg('<rect x="3" y="5" width="6" height="6" rx="1"/><path d="m4.5 8 1 1 2-2"/><rect x="3" y="14" width="6" height="6" rx="1"/><path d="M13 8h8M13 17h8"/>'),
  numbered: svg('<path d="M10 6h11M10 12h11M10 18h11"/><path d="M4 4.5 5.5 4v4" stroke-width="1.5"/><path d="M3.5 14h2.5l-2.5 4h2.5" stroke-width="1.5"/><path d="M3 21h3" stroke-width="1"/>'),
  quote: svg('<path d="M4 6v12"/><path d="M9 7h11M9 12h11M9 17h7"/>'),
};

/** Block containers: a task list (`- [ ] ..`, with cheq's preamble), a quote. */
export const BLOCKS: Action[] = [
  { label: 'Task list', shortcut: 'Mod+Shift+9', icon: ICONS.taskList, run: (c) => c.toggleTaskList(), active: (e) => e.isActive('taskList') },
  { label: 'Quote', shortcut: 'Mod+Shift+B', icon: ICONS.quote, run: (c) => c.toggleBlockquote(), active: (e) => e.isActive('blockquote') },
];

/** Insert a page break or a horizontal rule. */
export const BREAKS: Action[] = [
  { label: 'Insert page break', shortcut: 'Mod+Enter', icon: ICONS.pageBreak, run: (c) => c.setPageBreak() },
  { label: 'Horizontal rule', icon: ICONS.rule, run: (c) => c.setHorizontalRule() },
];

/** Whether the selection is in a table whose first row is a header row. */
function inHeaderTable(editor: Editor): boolean {
  const table = findParentNode((node) => node.type.name === 'table')(editor.state.selection);
  const first = table?.node.firstChild;
  return !!first && first.childCount > 0 && first.content.content.every((cell) => cell.type.name === 'tableHeader');
}

/** Makes the first row of the table a `table.header(..)`, or a normal row again. */
export const HEADER_ROW: Action = {
  label: 'Header row',
  icon: ICONS.headerRow,
  run: (c) => c.toggleHeaderRow(),
  active: inHeaderTable,
};

/** Numbers the headings (`#set heading(numbering: "1.")`), or stops numbering them. */
export const NUMBERED_HEADINGS: Action = {
  label: 'Numbered headings',
  icon: ICONS.numbered,
  run: (c) => c.toggleHeadingNumbering(),
  active: (e) => hasHeadingNumbering(e.state.doc),
};
