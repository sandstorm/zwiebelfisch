// What the lists extension contributes to the Visual view: bulleted and numbered lists (`- item` / `+ item`,
// `1. item`) as Tiptap's lists, task lists (task-lists.ts) and their buttons. See lists.ts.
import { BulletList, ListItem, ListKeymap, OrderedList } from '@tiptap/extension-list';
import { Extension } from '@tiptap/core';
import type { SyntaxNode } from '@lezer/common';
import type { Node } from '@tiptap/pm/model';
import { children } from '../../../core/typst-syntax/typst-syntax';
import { svg, type ToolbarAction, type TypstNodeSpec } from '../../../hosts/visual-view/visual-view';
import type { TypstParseContext, TypstSerializeState } from '../../../hosts/projection/projection';

/** Source anchors: `src`, the Typst a node was read from; `sep`, the whitespace to its next sibling. */
const ANCHORS = {
  src: { default: null, rendered: false, keepOnSplit: false },
  sep: { default: null, rendered: false },
};

/** A list item's first child may be verbatim Typst (an item whose body the Visual view cannot model); `marker` as written (`-`, `+`, `1.`). */
const TypstListItem = ListItem.extend({
  content: '(paragraph | rawBlock) block*',
  addAttributes() {
    return { ...this.parent?.(), ...ANCHORS, marker: { default: null, rendered: false } };
  },
});

/** Tiptap's lists (with the source anchors), items and list keymap. */
const Lists = Extension.create({
  name: 'typstLists',
  addExtensions: () => [
    ...[BulletList, OrderedList].map((list) =>
      list.extend({
        addAttributes() {
          return { ...this.parent?.(), ...ANCHORS };
        },
      }),
    ),
    TypstListItem,
    ListKeymap,
  ],
});

const ORDERED_MARKER = /^\d|^\+/;

const LIST: Omit<TypstNodeSpec, 'name'> = {
  typst: { toTypst: (state, list, pos) => state.blocks(list, pos + 1, '\n') },
  view: { keepsDom: true },
};

/**
 * List items are blocks of their own; consecutive items of the same kind
 * (bulleted: `-`, numbered: `+` or `1.`) form one list. An item holds one
 * paragraph; an item whose source has nested content keeps its body as a raw
 * block. Items keep their `marker`; edited items print it (`-` / `+` in a
 * list of the other kind), further children (nested lists made with Tab) on
 * following lines, indented.
 */
export const BULLET_LIST: TypstNodeSpec = { ...LIST, name: 'bulletList', tiptap: Lists };
export const ORDERED_LIST: TypstNodeSpec = { ...LIST, name: 'orderedList' };

function listItemToTypst(state: TypstSerializeState, item: Node, pos: number, list: Node): void {
  const ordered = list.type.name === 'orderedList';
  const keepMarker = item.attrs.marker !== null && ORDERED_MARKER.test(item.attrs.marker) === ordered;
  state.item(item, pos, `${keepMarker ? item.attrs.marker : ordered ? '+' : '-'} `);
}

export const LIST_ITEM: TypstNodeSpec = {
  name: 'listItem',
  typst: {
    parseTypst: { syntaxNodes: { ListItem: { block: parseListItem, standsAlone: true }, EnumItem: { block: parseListItem, standsAlone: true } } },
    toTypst: listItemToTypst,
    anchors: ['marker'],
    container: (item: Node) => (ORDERED_MARKER.test(item.attrs.marker ?? '') ? 'orderedList' : 'bulletList'),
  },
  view: { keepsDom: true },
};

function parseListItem(p: TypstParseContext, node: SyntaxNode, sep: string | null): Node {
  const marker = node.firstChild!;
  const markup = node.getChild('Markup');
  const body = markup ? children(markup) : [];
  const bodySrc = markup ? p.text(markup) : '';
  const content = p.isOneParagraph(body)
    ? p.textblock({ type: 'paragraph', attrs: { src: bodySrc } }, markup?.from ?? 0, p.inline(body))
    : p.schema.nodes.rawBlock.create({ src: bodySrc });
  return p.pristine('listItem', { marker: p.text(marker), src: p.text(node), sep }, [content]);
}

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
  { label: 'Bulleted list', icon: ICONS.bulletList, run: (c) => c.toggleBulletList(), active: (e) => e.isActive('bulletList') },
  { label: 'Numbered list', icon: ICONS.orderedList, run: (c) => c.toggleOrderedList(), active: (e) => e.isActive('orderedList') },
];
