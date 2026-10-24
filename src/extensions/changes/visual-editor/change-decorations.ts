// The changes of the comparison shown, drawn in the Visual editor. See changes in ../changes.ts.
import { Extension } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import type { ChangesState } from '../comparison';
import { changesSince, type Deletion, type DocumentChanges } from './changes-since';

/**
 * Decorations of what the editor's document changed since `original()` (none while that is undefined): new text
 * tinted and underlined, new blocks and boxes marked, deleted text struck through where it was (inline in a
 * paragraph, a read-only block between blocks). Worked out anew right after `onDidChange`, and a moment after the
 * document stops changing (mapped through the edits meanwhile).
 *
 * Used by: the changes extension, one per Visual editor.
 */
export function changeDecorations(changes: ChangesState): Extension {
  return Extension.create({
    name: 'changeDecorations',
    addProseMirrorPlugins() {
      return [
        new Plugin<DecorationSet>({
          key,
          state: {
            init: () => DecorationSet.empty,
            apply: (tr, set) => (tr.getMeta(key) as DecorationSet | undefined) ?? set.map(tr.mapping, tr.doc),
          },
          props: { decorations: (state) => key.getState(state) },
          view: (view) => new Refresher(view, changes),
        }),
      ];
    },
  });
}


const key = new PluginKey<DecorationSet>('changeDecorations');

/** How long the document stays unchanged before its changes are worked out anew (ms). */
const DELAY = 300;

/** Works out the decorations of one editor and dispatches them; the last result is kept for an unchanged input. */
class Refresher {
  #timer: ReturnType<typeof setTimeout> | undefined;
  #last: { original: string; doc: Node; changes: DocumentChanges } | null = null;
  readonly #subscription;

  constructor(
    private readonly view: EditorView,
    private readonly changes: ChangesState,
  ) {
    // also when nothing is drawn: the toolbar asks again whether its button shows
    this.#subscription = changes.onDidChange(() => this.#refresh());
    // not while the view is being made
    this.#later();
  }

  update(view: EditorView, before: { doc: Node }): void {
    if (view.state.doc !== before.doc) this.#later();
  }

  destroy(): void {
    clearTimeout(this.#timer);
    this.#subscription.dispose();
  }

  #later(): void {
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => this.#refresh(), DELAY);
  }

  #refresh(): void {
    clearTimeout(this.#timer);
    const { doc } = this.view.state;
    const original = this.changes.original();
    if (original !== undefined && (this.#last?.original !== original || this.#last.doc !== doc)) {
      this.#last = { original, doc, changes: changesSince(original, doc) };
    }
    const set = original === undefined ? DecorationSet.empty : DecorationSet.create(doc, decorations(doc, this.#last!.changes));
    this.view.dispatch(this.view.state.tr.setMeta(key, set).setMeta('addToHistory', false));
  }
}

function decorations(doc: Node, { inserted, deleted }: DocumentChanges): Decoration[] {
  return [...inserted.flatMap(({ from, to }) => insertion(doc, from, to)), ...deleted.map(deletion)];
}

/** New text `from..to`, and the blocks and boxes starting in it (which inline decorations skip). */
function insertion(doc: Node, from: number, to: number): Decoration[] {
  const found = [Decoration.inline(from, to, { class: 'zwf-changes__inserted' })];
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isBlock || pos < from) return true;
    found.push(Decoration.node(pos, pos + node.nodeSize, { class: 'zwf-changes__inserted-block' }));
    return false;
  });
  return found;
}

/** Deleted content where it was: struck-through text in a paragraph, else a read-only block of its lines. */
function deletion({ pos, lines, inline }: Deletion): Decoration {
  const toDOM = (view: EditorView) => {
    const html = view.dom.ownerDocument;
    const element = html.createElement(inline ? 'del' : 'div');
    element.className = inline ? 'zwf-changes__deleted' : 'zwf-changes__deleted-block';
    element.contentEditable = 'false';
    if (inline) element.textContent = lines.join(' ¶ ');
    else for (const line of lines) element.appendChild(html.createElement('del')).textContent = line;
    return element;
  };
  return Decoration.widget(pos, toDOM, { side: -1, ignoreSelection: true, marks: [], key: `${inline}:${lines.join('\n')}` });
}
