// The collaboration's part of the Visual view: other users' selections (highlights), carets (decorations), and their
// carets inside boxes (drawn in a raw box's code). See collaboration.ts.
import { Extension } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Event } from '../../../core/event-emitter/event-emitter';
import type { Highlight, TypstDocument } from '../../../core/typst-document/typst-document';
import type { HighlightProvider, VisualViewContext, VisualViewContribution } from '../../../hosts/visual-view/visual-view';
import { textColorOn } from '../../../ui/color-scheme/color-scheme';
import type { Presence, PresenceSource, PresenceUser } from '../presence/presence';
import { caretElement } from '../source-view/source-view';
import { boxCaretsSpec, boxPresence, type BoxCaret } from './box-carets';

/**
 * Draws the other users' places in every Visual view, as `presences` has them: their selections as highlights,
 * their carets in the view and in the code of its raw boxes; they follow edits. `documents`: the project's
 * documents now (any of them may have views).
 */
export function visualPresence(presences: PresenceSource, documents: () => readonly TypstDocument[]): VisualViewContribution {
  return {
    id: 'collaboration.presence',
    activate({ visualView, subscriptions }) {
      subscriptions.push(
        visualView.registerHighlights('collaboration.selections', selections(presences, documents)),
        visualView.registerEditorExtension((view) => remoteCarets(view, presences)),
        visualView.registerBoxCodeExtension(() => boxPresence),
      );
    },
  };
}

/** The others' selections in a document, tinted in their colors. */
function selections(presences: PresenceSource, documents: () => readonly TypstDocument[]): HighlightProvider {
  const onDidChangeHighlights: Event<TypstDocument> = (listener) =>
    presences.onDidChange(() => {
      for (const document of documents()) listener(document);
    });
  return { provideHighlights: (document) => presences.presencesIn(document).flatMap(selection), onDidChangeHighlights };
}

function selection({ user, anchor, head }: Presence): Highlight[] {
  if (anchor === head) return [];
  const attributes = { 'data-user': user.name, style: `--typst-remote-color: ${user.color}` };
  return [{ from: Math.min(anchor, head), to: Math.max(anchor, head), className: 'typst-remote-selection', attributes }];
}

const key = new PluginKey<DecorationSet>('typst-presence');

/**
 * Other users' carets in one Visual view, in the style of Tiptap's CollaborationCaret: a caret is a widget (a bar in
 * the user's color with a name flag), so it also shows in empty paragraphs. A caret inside something shown as a
 * whole (a raw box, an image, a page break, a margin note) outlines that box in the user's color with the name
 * instead; the box gets the caret's offset in its own source (`boxCaretsSpec`).
 */
function remoteCarets(view: VisualViewContext, presences: PresenceSource): Extension {
  const decorations = (doc: Node) => caretDecorations(view, doc, presences.presencesIn(view.document));
  return Extension.create({
    name: 'typstRemotePresence',
    addProseMirrorPlugins() {
      return [
        new Plugin<DecorationSet>({
          key,
          state: {
            init: (_config, state) => decorations(state.doc),
            apply(tr, set) {
              if (tr.getMeta(key)) return decorations(tr.doc);
              return tr.docChanged ? set.map(tr.mapping, tr.doc) : set;
            },
          },
          props: { decorations: (state) => key.getState(state) },
          view: (editor) => {
            const subscription = presences.onDidChange(() => editor.dispatch(editor.state.tr.setMeta(key, true)));
            return { destroy: () => subscription.dispose() };
          },
        }),
      ];
    },
  });
}

function caretDecorations(view: VisualViewContext, doc: Node, presences: readonly Presence[]): DecorationSet {
  const boxes = new Map<number, { node: Node; carets: BoxCaret[] }>();
  const decorations: Decoration[] = [];
  for (const { id, user, head } of presences) {
    const box = boxAt(view, doc, head);
    if (box) {
      const entry = boxes.get(box.pos) ?? { node: box.node, carets: [] };
      entry.carets.push({ id, user, offset: head - box.start });
      boxes.set(box.pos, entry);
    } else {
      // A caret sticks to the text before it: at the end of a line, the hidden line break or
      // blank line after it must not carry it to the start of the next one.
      decorations.push(caret(view.sourceToPos(doc, head, -1), id, user));
    }
  }
  for (const [pos, { node, carets }] of boxes) decorations.push(boxOutline(pos, node, carets));
  return DecorationSet.create(doc, decorations);
}

/** The caret widget; its key keeps the DOM while the same user moves. */
function caret(pos: number, id: string, user: PresenceUser): Decoration {
  return Decoration.widget(pos, (editor) => caretElement(editor.dom.ownerDocument, user), {
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
    style: `--typst-remote-color: ${color}; --typst-remote-text: ${textColorOn(color)}`,
  };
  return Decoration.node(pos, pos + node.nodeSize, attrs, boxCaretsSpec(carets));
}

/**
 * The box whose source holds `offset`: a block atom from its first character
 * up to its line end, an inline box strictly inside (a caret right before or
 * after it is drawn as a caret).
 */
function boxAt(view: VisualViewContext, doc: Node, offset: number): { pos: number; node: Node; start: number } | null {
  let found: { pos: number; node: Node; start: number } | null = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (!view.isBox(node)) return true;
    const start = view.posToSource(doc, pos);
    const end = view.posToSource(doc, pos + node.nodeSize);
    if (node.isBlock ? start <= offset && offset <= end : start < offset && offset < end) found = { pos, node, start };
    return false;
  });
  return found;
}
