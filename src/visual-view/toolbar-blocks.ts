import { findParentNode, type Editor } from '@tiptap/core';
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
  quote: svg('<path d="M4 6v12"/><path d="M9 7h11M9 12h11M9 17h7"/>'),
};

/** Block containers: a quote. */
export const BLOCKS: Action[] = [
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
