// The invisible characters in the Visual editor. See invisibles in ../invisibles.ts.
import { Extension } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Event } from '../../../core/event-emitter/event-emitter';

/**
 * Marks for the invisible characters of every paragraph (any textblock) while `shown()`: a space, a non-breaking
 * space and a tab get a class (inline decorations; CSS draws the mark over the character), a line break a widget
 * before it, the paragraph's end a widget after its text, a newline written in the source (shown as a space) the
 * space's class, unless it follows a line break (Typst drops it there). They are decorations only: the document and what is copied stay as they are.
 *
 * Turned on, all paragraphs are marked once; after that an edit marks anew only the paragraphs it touched, the other
 * marks follow the edit (ProseMirror's mapping), so typing costs the same in a long document as in a short one.
 */
export function invisibleMarks(state: InvisiblesState): Extension {
  return Extension.create({
    name: 'invisibleMarks',
    addProseMirrorPlugins() {
      return [
        new Plugin<DecorationSet | null>({
          key,
          state: {
            init: (_config, { doc }) => (state.shown() ? marks(doc) : null),
            apply(tr, set) {
              const shown = tr.getMeta(key) as boolean | undefined;
              if (shown !== undefined) return shown ? marks(tr.doc) : null;
              return set && tr.docChanged ? remark(set, tr) : set;
            },
          },
          props: { decorations: (editorState) => key.getState(editorState) ?? DecorationSet.empty },
          view: (view) => {
            const subscription = state.onDidChange((on) => view.dispatch(view.state.tr.setMeta(key, on)));
            return { destroy: () => subscription.dispose() };
          },
        }),
      ];
    },
  });
}

/** Whether the marks are shown, and word when that changes. */
export interface InvisiblesState {
  shown(): boolean;
  readonly onDidChange: Event<boolean>;
}

const key = new PluginKey<DecorationSet | null>('invisibleMarks');

/** The marks of every paragraph of `doc`. */
function marks(doc: Node): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.isTextblock) decorations.push(...paragraphMarks(node, pos));
    return !node.isTextblock;
  });
  return DecorationSet.create(doc, decorations);
}

/** `set` after `tr`: mapped, the paragraphs the edit touched marked anew. */
function remark(set: DecorationSet, tr: Transaction): DecorationSet {
  const { doc } = tr;
  const touched = new Map<number, Node>();
  tr.mapping.maps.forEach((map, index) => {
    const after = tr.mapping.slice(index + 1);
    map.forEach((_oldStart, _oldEnd, start, end) => {
      const from = Math.max(0, after.map(start, -1) - 1);
      const to = Math.min(doc.content.size, after.map(end, 1) + 1);
      doc.nodesBetween(from, to, (node, pos) => {
        if (node.isTextblock) touched.set(pos, node);
        return !node.isTextblock;
      });
    });
  });
  let mapped = set.map(tr.mapping, doc);
  for (const [pos, node] of touched) {
    mapped = mapped.remove(mapped.find(pos, pos + node.nodeSize)).add(doc, paragraphMarks(node, pos));
  }
  return mapped;
}

/** The marks of the textblock `node` at `pos`. */
function paragraphMarks(node: Node, pos: number): Decoration[] {
  const decorations: Decoration[] = [];
  node.forEach((child, offset, index) => {
    const at = pos + 1 + offset;
    if (child.isText) {
      const text = child.text!;
      for (let char = 0; char < text.length; char++) {
        const mark = CHARACTER_MARKS[text[char]];
        if (mark) decorations.push(Decoration.inline(at + char, at + char + 1, { class: mark }));
      }
    } else if (child.type.name === 'softBreak' && node.maybeChild(index - 1)?.type.name !== 'hardBreak') {
      decorations.push(Decoration.node(at, at + child.nodeSize, { class: CHARACTER_MARKS[' '] }));
    } else if (child.type.name === 'hardBreak') {
      decorations.push(Decoration.widget(at, widget('zwf-invisibles__break'), { side: -1, key: 'zwf-invisibles__break', ignoreSelection: true }));
    }
  });
  const end = pos + node.nodeSize - 1;
  decorations.push(Decoration.widget(end, widget('zwf-invisibles__paragraph'), { side: 1, key: 'zwf-invisibles__paragraph', ignoreSelection: true, marks: [] }));
  return decorations;
}

/** The class of each invisible character within a line: CSS draws its mark. */
const CHARACTER_MARKS: Readonly<Record<string, string>> = {
  ' ': 'zwf-invisibles__space',
  '\u00a0': 'zwf-invisibles__nbsp',
  '\t': 'zwf-invisibles__tab',
};

/** A widget's element: empty, its mark drawn by CSS (so never in the text), hidden from screen readers. */
function widget(className: string): (view: { dom: HTMLElement }) => HTMLElement {
  return (view) => {
    const span = view.dom.ownerDocument.createElement('span');
    span.className = className;
    span.setAttribute('aria-hidden', 'true');
    return span;
  };
}
