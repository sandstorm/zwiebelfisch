// References and labels in the Visual view: `@key` chips, label tags on blocks, the `@` suggestion list, "Add
// label". Entry of visual-view/builtins/references/. See ARCHITECTURE.md, "VisualView".
import { Extension } from '@tiptap/core';
import type { TypstDocument } from '../../../../core/typst-document/typst-document';
import type { ProjectLabels } from '../../../../features/labels/labels';
import { svg, type Action, type ToolbarContext, type TypstNodeSpec, type VisualViewContribution } from '../../contributions/contributions';
import { canStartNewLabel, labelTags, startNewLabel } from './label-tags';
import { referenceHints } from './reference-hints';
import { Reference } from './reference-node';
import { referenceSuggestion } from './reference-suggestion';
import { guardAfterReference, referenceSyntax } from './reference-syntax';

export interface ReferencesOptions {
  /**
   * The project's labels: typing `@` offers them, reference chips show what they point to (or that the label is
   * missing), and a label can be renamed with its references in every file (default: label tags only).
   */
  labels?: ProjectLabels;
}

/**
 * References (`@key`, `@key[supplement]`) as `reference` chips; a block's
 * label shown as a tag (rename, remove), "Add label" in the Insert menu, and
 * — with the project's `labels` — hints on reference chips (what they point
 * to, or that the label is missing) and the `@` list of labels to insert
 * references from. Without `labels`, only the tags (renaming just the label).
 */
export function references(options: ReferencesOptions = {}): VisualViewContribution {
  const { labels } = options;
  return {
    id: 'references',
    activate({ visualView, subscriptions }) {
      subscriptions.push(
        visualView.registerNode(REFERENCE),
        visualView.registerEditorExtension((view) => referencesExtension(labels, view.document)),
        visualView.registerToolbarItem({ group: 'insert', order: 80, create: addLabel }),
      );
    },
  };
}

/** `@key` / `@key[supplement]`: a `reference` atom; the supplement is kept as written. */
const REFERENCE: TypstNodeSpec = {
  name: 'reference',
  extension: Reference,
  inlineSyntax: {
    Ref: (p, node, marks) => {
      const marker = node.getChild('RefMarker')!;
      const supplement = node.getChild('ContentBlock');
      const attrs = { target: p.source.slice(marker.from + 1, marker.to), supplement: supplement ? p.text(supplement) : null };
      return p.schema.nodes.reference.create(attrs, null, marks);
    },
  },
  printAtom: (node) => referenceSyntax(node.attrs.target, node.attrs.supplement),
  escapeAfter: guardAfterReference,
};

/** The plugins of one view: label tags, and with `labels` the `@` list and reference hints. */
function referencesExtension(labels: ProjectLabels | undefined, document: TypstDocument): Extension {
  return Extension.create({
    name: 'typstReferences',
    // before the keymaps: Enter, Tab and Escape go to an open @ list first
    priority: 1000,
    addProseMirrorPlugins() {
      const tags = labelTags({ labels, document });
      return labels ? [referenceSuggestion(labels), referenceHints(labels), tags] : [tags];
    },
  });
}

const ICON = svg('<path d="M3 12V4h8l9 8-8 8z"/><circle cx="7.5" cy="8.5" r="1.2"/>');

/**
 * "Add label": a label (`<fig:logo>`) on the figure or block the selection is in, typed into a draft tag
 * right where it will show (starting with `fig:`, `tab:` or `sec:` as is customary). Enabled where that
 * block has none yet; an existing label is renamed or removed through its tag.
 */
function addLabel(toolbar: ToolbarContext): Action {
  return {
    label: 'Add label',
    icon: ICON,
    run: (c) => c,
    enabled: (editor) => canStartNewLabel(editor.state) !== null,
    click: () => startNewLabel(toolbar.editor.view),
  };
}
