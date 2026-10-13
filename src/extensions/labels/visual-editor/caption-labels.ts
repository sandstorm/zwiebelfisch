// Labels named after a figure's caption, added once the caption is written. See labels in ../labels.ts.
import type { Node } from '@tiptap/pm/model';
import { type EditorState, Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { captionLabel } from '../model/caption-label';
import type { ProjectLabels } from '../model/label-index';
import { labelPrefix } from './label-tags';

/**
 * A figure without a label whose caption the user wrote gets one named after the caption (`fig:company-logo`, see
 * `captionLabel`) once the cursor leaves the caption: a figure is referenced by its label, so writing a caption is
 * where it gets one. Changes that come from the source (or another user) are left alone; an existing label, or one
 * removed later, stays as it is.
 */
export function captionLabels(labels: ProjectLabels): Plugin {
  return new Plugin<number[]>({
    key,
    state: {
      init: () => [],
      apply: (tr, pending) => {
        const done: number[] = tr.getMeta(key) ?? [];
        const mapped = pending.filter((pos) => !done.includes(pos)).map((pos) => tr.mapping.map(pos));
        return tr.docChanged && tr.getMeta('addToHistory') !== false ? [...new Set([...mapped, ...editedCaptions(tr)])] : mapped;
      },
    },
    appendTransaction(_, __, state) {
      const pending = key.getState(state)!;
      const done = pending.filter((pos) => !inCaptionOf(state, pos));
      if (done.length === 0) return null;
      const tr = state.tr.setMeta(key, done);
      const taken = new Set([...labels.labels().map((label) => label.name), ...documentLabels(state.doc)]);
      for (const pos of done) {
        const figure = state.doc.nodeAt(pos);
        const caption = figure?.type.name === 'figure' && !figure.attrs.label ? figure.maybeChild(1) : null;
        const name = caption ? captionLabel(labelPrefix(figure!), caption.textContent, (n) => taken.has(n)) : null;
        if (name === null) continue;
        taken.add(name);
        tr.setNodeAttribute(pos, 'label', { name, gap: ' ' });
      }
      return tr;
    },
  });
}

const key = new PluginKey<number[]>('typstCaptionLabels');

/** The unlabelled figures (their positions) whose caption `tr` changed. */
function editedCaptions(tr: Transaction): number[] {
  const figures: number[] = [];
  tr.mapping.maps.forEach((map, i) => {
    const rest = tr.mapping.slice(i + 1);
    map.forEach((_from, _to, from, to) => {
      tr.doc.nodesBetween(rest.map(from, -1), rest.map(to, 1), (node, pos, parent, index) => {
        if (node.type.name === 'figureCaption' && parent?.type.name === 'figure' && !parent.attrs.label && index === 1) {
          figures.push(tr.doc.resolve(pos).before());
        }
        return node.type.name !== 'figureCaption';
      });
    });
  });
  return figures;
}

/** Whether the cursor is in the caption of the figure at `pos`. */
function inCaptionOf(state: EditorState, pos: number): boolean {
  const { $from } = state.selection;
  return $from.depth >= 2 && $from.parent.type.name === 'figureCaption' && $from.before($from.depth - 1) === pos;
}

/** The labels of this document (the project's index follows it only after a while). */
function documentLabels(doc: Node): string[] {
  const names: string[] = [];
  doc.descendants((node) => {
    if (node.attrs.label?.name) names.push(node.attrs.label.name);
  });
  return names;
}
