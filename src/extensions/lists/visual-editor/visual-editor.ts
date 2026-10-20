// The lists extension's part of the Visual editor. See lists in ../lists.ts.
import { BulletList, ListItem, ListKeymap, OrderedList } from '@tiptap/extension-list';
import { Extension, wrappingInputRule } from '@tiptap/core';
import type { SyntaxNode } from '@lezer/common';
import { Fragment, type Node } from '@tiptap/pm/model';
import { svg, type ToolbarAction, type TypstNodeSpec, type TypstParseContext, type TypstSerializeState } from '../../../hosts/visual-editor/visual-editor';
import { TASK_BOX } from './task-lists';

const LIST: Omit<TypstNodeSpec, 'name'> = {
  typst: { toTypst: (state, list, pos) => state.blocks(list, pos + 1, '\n') },
  view: { keepsDom: true },
};

/**
 * Bulleted and numbered lists (`- item` / `+ item`, `1. item`) as Tiptap's lists. Consecutive items of the same kind
 * (bulleted: `-`, numbered: `+` or `1.`) form one list. An item holds a paragraph, then further blocks (nested lists)
 * on its following lines, indented. Items keep their `marker` and the indentation of their further lines when printed
 * back.
 */
export const BULLET_LIST: TypstNodeSpec = { ...LIST, name: 'bulletList', tiptap: tiptapLists() };
export const ORDERED_LIST: TypstNodeSpec = { ...LIST, name: 'orderedList' };

export const LIST_ITEM: TypstNodeSpec = {
  name: 'listItem',
  typst: {
    parseTypst: { syntaxNodes: { ListItem: { block: parseListItem, standsAlone: true }, EnumItem: { block: parseListItem, standsAlone: true } } },
    toTypst: listItemToTypst,
    anchors: ['marker', 'indent'],
    container: (item: Node) => (ORDERED_MARKER.test(item.attrs.marker ?? '') ? 'orderedList' : 'bulletList'),
  },
  view: { keepsDom: true },
};

const ICONS = {
  bulletList: svg(
    '<circle cx="5" cy="7" r="1" fill="currentColor"/><circle cx="5" cy="12" r="1" fill="currentColor"/>' +
      '<circle cx="5" cy="17" r="1" fill="currentColor"/><path d="M10 7h10M10 12h10M10 17h10"/>',
  ),
  orderedList: svg(
    '<path d="M10 7h10M10 12h10M10 17h10"/><path d="M4 5h1.5v4" stroke-width="1.5"/>' +
      '<path d="M3.5 14h2.5l-2.5 4h2.5" stroke-width="1.5"/>',
  ),
};

/** "Bulleted list" and "Numbered list", in the toolbar's `lists` group. */
export const LIST_ACTIONS: ToolbarAction[] = [
  { label: 'Bulleted list', keywords: ['bullet', 'unordered', 'list', '-'], icon: ICONS.bulletList, run: (c) => c.toggleBulletList(), active: (e) => e.isActive('bulletList') },
  { label: 'Numbered list', keywords: ['numbered', 'ordered', 'enumerate', '123', '+'], icon: ICONS.orderedList, run: (c) => c.toggleOrderedList(), active: (e) => e.isActive('orderedList') },
];

/** Tiptap's lists (with the source anchors, typed as in Typst), items and list keymap. */
function tiptapLists(): Extension {
  return Extension.create({
    name: 'typstLists',
    addExtensions: () => [
      BulletList.extend({
        addAttributes() {
          return { ...this.parent?.(), ...ANCHORS };
        },
        // Typst's `- ` only: Markdown's `+ ` and `* ` mean other things in Typst
        addInputRules() {
          return [wrappingInputRule({ find: /^\s*-\s$/, type: this.type })];
        },
      }),
      OrderedList.extend({
        addAttributes() {
          return { ...this.parent?.(), ...ANCHORS };
        },
        // Typst's `+ `, and Tiptap's `1. `
        addInputRules() {
          return [wrappingInputRule({ find: /^\s*\+\s$/, type: this.type }), ...(this.parent?.() ?? [])];
        },
      }),
      TypstListItem,
      ListKeymap,
    ],
  });
}

/**
 * A list item's first child may be verbatim Typst (an item whose body the Visual editor cannot model). Its `marker` as
 * written, with the whitespace after it (`- `, `+ `, `1.  `); `indent`, the whitespace starting its further lines.
 */
const TypstListItem = ListItem.extend({
  content: '(paragraph | rawBlock) block*',
  addAttributes() {
    return { ...this.parent?.(), ...ANCHORS, marker: { default: null, rendered: false }, indent: { default: null, rendered: false } };
  },
});

/** The source anchor of lists and items: `sep`, the whitespace to the next sibling. */
const ANCHORS = { sep: { default: null, rendered: false } };

/**
 * An item's body is its blocks: a paragraph, then nested lists or other blocks. It is one raw block if it cannot be
 * (a heading first), or if it is a task with more than a paragraph (whose box an edit would escape).
 */
function parseListItem(p: TypstParseContext, node: SyntaxNode, sep: string | null): Node | null {
  const markup = node.getChild('Markup');
  if (!markup) return null;
  const { content, src, indent } = p.itemBlocks(markup);
  const type = p.schema.nodes.listItem;
  const modelled = type.validContent(Fragment.from(content)) && !(content.length > 1 && TASK_BOX.test(src));
  const blocks = modelled ? content : [p.schema.nodes.rawBlock.create({ src })];
  return type.create({ marker: p.source.slice(node.from, markup.from), indent, sep }, blocks);
}

function listItemToTypst(state: TypstSerializeState, item: Node, pos: number, list: Node): void {
  const ordered = list.type.name === 'orderedList';
  const marker: string | null = item.attrs.marker;
  const keepMarker = marker !== null && ORDERED_MARKER.test(marker) === ordered;
  const prefix = keepMarker ? marker : ordered ? '+' : '-';
  // an empty item may stand without the space after its marker (`-` at the end of a line)
  const spaced = /\s$/.test(prefix) || isEmpty(item) ? prefix : `${prefix} `;
  state.item(item, pos, spaced, item.attrs.indent ?? undefined);
}

const ORDERED_MARKER = /^\d|^\+/;

function isEmpty(item: Node): boolean {
  return item.childCount === 1 && item.firstChild!.isTextblock && item.firstChild!.content.size === 0;
}
