/**
 * "Track changes" for the Visual view: what changed against a base version,
 * drawn the way Word users know it — insertions highlighted, deletions as
 * struck-through text where they were, formatting changes marked, changed
 * code (raw boxes) outlined as a whole.
 *
 * Derived from the text diff (`diffTexts`) mapped through the position map, so
 * it shows exactly what the Source view's diff shows.
 */
import type { Node } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { diffTexts, type Change } from '../diff/diff';
import { print, project, sourceToPos } from './projection';

export type ChangeKind = 'insert' | 'delete' | 'format' | 'changed';

const CLASSES: Record<ChangeKind, string> = {
  insert: 'typst-diff-insert',
  delete: 'typst-diff-delete',
  format: 'typst-diff-format',
  changed: 'typst-diff-changed',
};

/** The decorations showing how `doc` differs from `base` (both projections). */
export function changeDecorations(doc: Node, base: Node): DecorationSet {
  const decorations = diffTexts(print(base), print(doc)).flatMap((change) => decorate(doc, base, change));
  return DecorationSet.create(doc, decorations);
}

function decorate(doc: Node, base: Node, change: Change): Decoration[] {
  const [from, to] = docRange(doc, change.fromB, change.toB);
  const [baseFrom, baseTo] = docRange(base, change.fromA, change.toA);
  const inserted = visibleText(doc, from, to);
  const deleted = visibleText(base, baseFrom, baseTo);
  const atoms = rawAtoms(doc, from, to).map(({ pos, node }) =>
    Decoration.node(pos, pos + node.nodeSize, { class: CLASSES.changed }, { change: 'changed' }),
  );
  if (inserted && inserted === deleted) return [inline(from, to, 'format'), ...atoms];
  const result: Decoration[] = [];
  if (deleted) result.push(deletion(from, deleted));
  if (inserted) result.push(inline(from, to, 'insert'));
  return [...result, ...atoms];
}

/** The document range showing source `from..to`; an atom when the range lies inside one. */
function docRange(doc: Node, from: number, to: number): [number, number] {
  const start = sourceToPos(doc, from);
  return [start, Math.max(start, sourceToPos(doc, to, -1))];
}

/** The text a reader sees in `from..to`; code (raw boxes) and breaks count as nothing. */
function visibleText(doc: Node, from: number, to: number): string {
  return doc.textBetween(from, to, ' ', '');
}

function rawAtoms(doc: Node, from: number, to: number): { pos: number; node: Node }[] {
  const atoms: { pos: number; node: Node }[] = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name.startsWith('raw') && pos >= from && pos + node.nodeSize <= to) atoms.push({ pos, node });
  });
  return atoms;
}

function inline(from: number, to: number, change: ChangeKind): Decoration {
  return Decoration.inline(from, to, { class: CLASSES[change] }, { change });
}

function deletion(pos: number, text: string): Decoration {
  const toDOM = (view: { dom: HTMLElement }) => {
    const element = view.dom.ownerDocument.createElement('del');
    element.className = CLASSES.delete;
    element.textContent = text;
    return element;
  };
  return Decoration.widget(pos, toDOM, { side: -1, marks: [], change: 'delete', text, key: `delete:${text}` });
}

// ---------------------------------------------------------------- plugin

interface ChangesState {
  base: Node | null;
  decorations: DecorationSet;
}

const key = new PluginKey<ChangesState>('typst-changes');

/** Keeps the change decorations up to date with every edit while a base is set. */
export const changesPlugin = new Plugin<ChangesState>({
  key,
  state: {
    init: () => ({ base: null, decorations: DecorationSet.empty }),
    apply(tr, value, _old, state) {
      const meta = tr.getMeta(key) as { base: string | null } | undefined;
      const base = meta ? (meta.base === null ? null : project(meta.base, state.schema)) : value.base;
      if (!base) return { base, decorations: DecorationSet.empty };
      if (!meta && !tr.docChanged) return value;
      return { base, decorations: changeDecorations(state.doc, base) };
    },
  },
  props: {
    decorations: (state: EditorState) => key.getState(state)?.decorations,
  },
});

/** Shows changes against `base` (Typst source), or none for null. */
export function setChangesBase(tr: Transaction, base: string | null): Transaction {
  return tr.setMeta(key, { base }).setMeta('addToHistory', false);
}
