// References and labels in the Visual view: `@key` chips, label tags on blocks, the `@` suggestion list, "Add
// label". See docs/guide/features.typ.
import { Extension } from '@tiptap/core';
import type { TypstDocument } from '../../../core/typst-document/typst-document';
import { guardAfterReference, referenceSyntax } from '../model/reference-syntax';
import type { ProjectLabels } from '../model/label-index';
import { svg, type ToolbarAction, type ToolbarContext, type TypstNodeSpec, type VisualViewContribution } from '../../../hosts/visual-view/visual-view';
import { canStartNewLabel, labelTags, startNewLabel, type LabelPrompts } from './label-tags';
import { referenceHints } from './reference-hints';
import { Reference } from './reference-node';
import { referenceSuggestion } from './reference-suggestion';

export interface ReferencesOptions {
  /**
   * The project's labels: typing `@` offers them, reference chips show what they point to (or that the label is
   * missing), and a label can be renamed with its references in every file.
   */
  labels: ProjectLabels;
  /** Where a label tag asks what to do and for the new name: the window's quick pick and input box. */
  prompts: LabelPrompts;
}

/**
 * References (`@key`, `@key[supplement]`) as `reference` chips with hints
 * (what they point to, or that the label is missing); a block's label shown
 * as a tag (rename, with the references in every file, or remove); the `@`
 * list of labels to insert references from; "Add label" in the Insert menu.
 */
export function references(options: ReferencesOptions): VisualViewContribution {
  const { labels, prompts } = options;
  return {
    id: 'references',
    activate({ visualView, subscriptions }) {
      subscriptions.push(
        visualView.registerNode(REFERENCE),
        visualView.registerTiptapExtension((view) => referencesExtension(labels, view.document, prompts)),
        visualView.registerToolbarItem({ group: 'insert', order: 80, create: addLabel }),
      );
    },
  };
}

/** `@key` / `@key[supplement]`: a `reference` atom; the supplement is kept as written. */
const REFERENCE: TypstNodeSpec = {
  name: 'reference',
  tiptap: Reference,
  typst: {
    parseTypst: {
      syntaxNodes: {
        Ref: {
          inline: (p, node, marks) => {
            const marker = node.getChild('RefMarker')!;
            const supplement = node.getChild('ContentBlock');
            const attrs = { target: p.source.slice(marker.from + 1, marker.to), supplement: supplement ? p.text(supplement) : null };
            return p.schema.nodes.reference.create(attrs, null, marks);
          },
        },
      },
    },
    atomToTypst: (node) => referenceSyntax(node.attrs.target, node.attrs.supplement),
    escapeAfter: (reference, text) => guardAfterReference(reference.attrs.supplement, text),
  },
};

/** The plugins of one view: the `@` list, reference hints, label tags. */
function referencesExtension(labels: ProjectLabels, document: TypstDocument, prompts: LabelPrompts): Extension {
  return Extension.create({
    name: 'typstReferences',
    // before the keymaps: Enter, Tab and Escape go to an open @ list first
    priority: 1000,
    addProseMirrorPlugins() {
      return [referenceSuggestion(labels), referenceHints(labels), labelTags({ labels, document, prompts })];
    },
  });
}

const ICON = svg('<path d="M3 12V4h8l9 8-8 8z"/><circle cx="7.5" cy="8.5" r="1.2"/>');

/**
 * "Add label": a label (`<fig:logo>`) on the figure or block the selection is in, typed into a draft tag
 * right where it will show (starting with `fig:`, `tab:` or `sec:` as is customary). Enabled where that
 * block has none yet; an existing label is renamed or removed through its tag.
 */
function addLabel(toolbar: ToolbarContext): ToolbarAction {
  return {
    label: 'Add label',
    icon: ICON,
    run: (c) => c,
    enabled: (editor) => canStartNewLabel(editor.state) !== null,
    click: () => startNewLabel(toolbar.editor.view),
  };
}
