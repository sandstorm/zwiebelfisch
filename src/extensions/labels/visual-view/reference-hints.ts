// Reference hints: what a reference chip points to ("Section · Method"), or that its label does not exist.
// See visual-view.ts.
import type { Node } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { ProjectPath } from '../../../core/paths/paths';
import { describeLabel } from '../model/label-choices';
import type { LabelInfo, ProjectLabels } from '../model/label-index';

const key = new PluginKey<DecorationSet>('typstReferenceHints');

/**
 * Decorates every reference chip with what its label labels (`data-hint`, and
 * a hover tooltip with it and the file; nothing extra is drawn inline) or, when the project
 * has no such label, marks it unknown (wavy underline, a tooltip saying why;
 * Typst reports the same error). Follows edits and changes of the project's
 * labels.
 */
export function referenceHints(labels: ProjectLabels): Plugin {
  return new Plugin({
    key,
    state: {
      init: (_, state) => hints(state.doc, labels.labels()),
      apply: (tr, old) => (tr.docChanged || tr.getMeta(key) ? hints(tr.doc, labels.labels()) : old),
    },
    props: { decorations: (state) => key.getState(state) },
    view: (view) => {
      let live = true;
      // the labels change while another view (or this one) handles a transaction: redraw afterwards
      const subscription = labels.onDidChange(() => queueMicrotask(() => live && view.dispatch(view.state.tr.setMeta(key, true))));
      return {
        destroy: () => {
          live = false;
          subscription.dispose();
        },
      };
    },
  });
}

function hints(doc: Node, labels: readonly LabelInfo[]): DecorationSet {
  const byName = new Map<string, LabelInfo>();
  for (const label of labels) if (!byName.has(label.name)) byName.set(label.name, label);
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'reference') return true;
    const target: string = node.attrs.target;
    const label = byName.get(target);
    decorations.push(Decoration.node(pos, pos + node.nodeSize, label ? known(label) : unknown(target)));
    return false;
  });
  return DecorationSet.create(doc, decorations);
}

function known(label: LabelInfo): Record<string, string> {
  const hint = describeLabel(label);
  const where = `in ${ProjectPath.displayName(label.path)}`;
  return hint ? { 'data-hint': hint, title: `${hint} (${where})` } : { title: `<${label.name}> ${where}` };
}

function unknown(target: string): Record<string, string> {
  return { class: 'typst-labels__ref--unknown', title: `The project has no label <${target}>: Typst reports this reference as an error.` };
}
