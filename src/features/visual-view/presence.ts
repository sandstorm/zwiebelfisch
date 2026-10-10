// Other users' carets and selections in the Visual view (decorations, and carets inside boxes). See visual-view.ts.
import { Extension } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { caretElement, flagTextColor, type Presence, type PresenceUser } from '../../core/typst-document/typst-document';
import { rangeDecorations } from './highlights';
import { posToSource, sourceToPos } from './projection/projection';

const key = new PluginKey<DecorationSet>('typst-presence');

/** A remote caret inside a box, as the box's decoration hands it to the box: `offset` counts from the box's source start. */
export interface BoxCaret {
  id: string;
  user: PresenceUser;
  offset: number;
}

/** Inline atoms shown as a box of their own (block atoms always are). */
const INLINE_BOXES = new Set(['rawInline', 'marginNote']);

/**
 * Other users' places in the Visual view, in the style of Tiptap's
 * CollaborationCaret: a caret is a widget (a bar in the user's color with
 * a name flag), so it also shows in empty paragraphs; a selection is tinted.
 * A caret inside something shown as a whole (a raw box, an image, a page
 * break, a margin note) outlines that box in the user's color with the name
 * instead; the box gets the caret's offset in its own source (`boxCarets`).
 */
export const remotePresence = Extension.create({
  name: 'typstRemotePresence',
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, set) {
            const presences = tr.getMeta(key) as readonly Presence[] | undefined;
            if (presences) return presenceDecorations(tr.doc, presences);
            return tr.docChanged ? set.map(tr.mapping, tr.doc) : set;
          },
        },
        props: { decorations: (state) => key.getState(state) },
      }),
    ];
  },
});

/** Marks `tr` to show `presences` (source offsets), replacing the ones shown. */
export function setPresence(tr: Transaction, presences: readonly Presence[]): Transaction {
  return tr.setMeta(key, presences);
}

/** The remote carets inside a box, from the decorations its node view is given. */
export function boxCarets(decorations: readonly Decoration[]): BoxCaret[] {
  return decorations.flatMap((decoration) => (decoration.spec as { boxCarets?: BoxCaret[] }).boxCarets ?? []);
}

function presenceDecorations(doc: Node, presences: readonly Presence[]): DecorationSet {
  const boxes = new Map<number, { node: Node; carets: BoxCaret[] }>();
  const decorations: Decoration[] = [];
  for (const { id, user, anchor, head } of presences) {
    if (anchor !== head) decorations.push(...selection(doc, user, anchor, head));
    const box = boxAt(doc, head);
    if (box) {
      const entry = boxes.get(box.pos) ?? { node: box.node, carets: [] };
      entry.carets.push({ id, user, offset: head - box.start });
      boxes.set(box.pos, entry);
    } else {
      decorations.push(caret(sourceToPos(doc, head), id, user));
    }
  }
  for (const [pos, { node, carets }] of boxes) decorations.push(boxOutline(pos, node, carets));
  return DecorationSet.create(doc, decorations);
}

function selection(doc: Node, user: PresenceUser, anchor: number, head: number): Decoration[] {
  const attributes = { 'data-user': user.name, style: `--typst-remote-color: ${user.color}` };
  return rangeDecorations(doc, { from: Math.min(anchor, head), to: Math.max(anchor, head), className: 'typst-remote-selection', attributes });
}

/** The caret widget; its key keeps the DOM while the same user moves. */
function caret(pos: number, id: string, user: PresenceUser): Decoration {
  return Decoration.widget(pos, (view) => caretElement(view.dom.ownerDocument, user), {
    key: `caret:${id}:${user.name}:${user.color}`,
    side: 1,
    ignoreSelection: true,
  });
}

/** Outlines a box in the color of the first user in it; the flag names everyone in it. */
function boxOutline(pos: number, node: Node, carets: BoxCaret[]): Decoration {
  const { color } = carets[0].user;
  const attrs = {
    class: 'typst-remote-box',
    'data-user': carets.map((c) => c.user.name).join(', '),
    style: `--typst-remote-color: ${color}; --typst-remote-text: ${flagTextColor(color)}`,
  };
  return Decoration.node(pos, pos + node.nodeSize, attrs, { boxCarets: carets });
}

/**
 * The box whose source holds `offset`: a block atom from its first character
 * up to its line end, an inline box strictly inside (a caret right before or
 * after it is drawn as a caret).
 */
function boxAt(doc: Node, offset: number): { pos: number; node: Node; start: number } | null {
  let found: { pos: number; node: Node; start: number } | null = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (!isBox(node)) return true;
    const start = posToSource(doc, pos);
    const end = posToSource(doc, pos + node.nodeSize);
    if (node.isBlock ? start <= offset && offset <= end : start < offset && offset < end) found = { pos, node, start };
    return false;
  });
  return found;
}

function isBox(node: Node): boolean {
  return node.isBlock ? node.isAtom : INLINE_BOXES.has(node.type.name);
}
