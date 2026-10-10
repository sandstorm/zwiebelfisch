import { svg, type Action } from './toolbar-action';

/**
 * Toolbar entries for the block nodes modelled on Tiptap's (page break,
 * horizontal rule, …), kept apart from `toolbar.ts` so each node's entry
 * lives next to the others of its kind.
 */
const ICONS = {
  pageBreak: svg('<path d="M6 3v5h12V3"/><path d="M6 21v-5h12v5"/><path d="M3 12h2M8 12h2M14 12h2M19 12h2"/>'),
  rule: svg('<path d="M3 12h18"/>'),
};

/** Insert a page break or a horizontal rule. */
export const BREAKS: Action[] = [
  { label: 'Insert page break', shortcut: 'Mod+Enter', icon: ICONS.pageBreak, run: (c) => c.setPageBreak() },
  { label: 'Horizontal rule', icon: ICONS.rule, run: (c) => c.setHorizontalRule() },
];
