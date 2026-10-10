// What the lists extension contributes to the Visual view: bulleted and numbered lists (`- item` / `+ item`,
// `1. item`) as Tiptap's lists, task lists (task-lists.ts) and their buttons. See lists.ts.
import { BulletList, ListItem, ListKeymap, OrderedList } from '@tiptap/extension-list';
import { Extension } from '@tiptap/core';
import type { SyntaxNode } from '@lezer/common';
import type { Node } from '@tiptap/pm/model';
import { children } from '../../../core/typst-syntax/typst-syntax';
import { svg, type Action, type TypstNodeSpec } from '../../../hosts/visual-view/visual-view';
import type { BlockPrinter, ProjectionContext } from '../../../hosts/projection/projection';

/** A list item's first child may be verbatim Typst (an item whose body the Visual view cannot model). */
const TypstListItem = ListItem.extend({ content: '(paragraph | rawBlock) block*' });

/** Tiptap's lists, items and list keymap. */
const Lists = Extension.create({
  name: 'typstLists',
  addExtensions: () => [BulletList, OrderedList, TypstListItem, ListKeymap],
});

const ORDERED_MARKER = /^\d|^\+/;

const ANCHORS = {
  src: { default: null, rendered: false, keepOnSplit: false },
  sep: { default: null, rendered: false },
};

const LIST: Omit<TypstNodeSpec, 'name'> = {
  attributes: ANCHORS,
  keepsDom: true,
  print: (out, list, pos) => out.blocks(list, pos + 1, '\n'),
};

/**
 * List items are blocks of their own; consecutive items of the same kind
 * (bulleted: `-`, numbered: `+` or `1.`) form one list. An item holds one
 * paragraph; an item whose source has nested content keeps its body as a raw
 * block. Items keep their `marker`; edited items print it (`-` / `+` in a
 * list of the other kind), further children (nested lists made with Tab) on
 * following lines, indented.
 */
export const BULLET_LIST: TypstNodeSpec = { ...LIST, name: 'bulletList', extension: Lists };
export const ORDERED_LIST: TypstNodeSpec = { ...LIST, name: 'orderedList' };

const printListItem: BlockPrinter = (out, item, pos, list) => {
  const ordered = list.type.name === 'orderedList';
  const keepMarker = item.attrs.marker !== null && ORDERED_MARKER.test(item.attrs.marker) === ordered;
  out.item(item, pos, `${keepMarker ? item.attrs.marker : ordered ? '+' : '-'} `);
};

export const LIST_ITEM: TypstNodeSpec = {
  name: 'listItem',
  attributes: { ...ANCHORS, marker: { default: null, rendered: false } },
  anchors: ['marker'],
  keepsDom: true,
  container: (item: Node) => (ORDERED_MARKER.test(item.attrs.marker ?? '') ? 'orderedList' : 'bulletList'),
  blockSyntax: { ListItem: { project: listItem }, EnumItem: { project: listItem } },
  print: printListItem,
};

function listItem(p: ProjectionContext, node: SyntaxNode, sep: string | null): Node {
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
export const LIST_ACTIONS: Action[] = [
  { label: 'Bulleted list', icon: ICONS.bulletList, run: (c) => c.toggleBulletList(), active: (e) => e.isActive('bulletList') },
  { label: 'Numbered list', icon: ICONS.orderedList, run: (c) => c.toggleOrderedList(), active: (e) => e.isActive('orderedList') },
];
