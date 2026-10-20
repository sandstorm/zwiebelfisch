// References and labels in the Visual editor. See labels in ../labels.ts.
import { Extension } from '@tiptap/core';
import { Disposable } from '../../../core/disposable/disposable';
import type { TypstDocument } from '../../../core/typst-document/typst-document';
import { guardAfterReference, referenceSyntax } from '../model/reference-syntax';
import type { ProjectLabels } from '../model/label-index';
import { svg, type CompletionItem, type CompletionItemProvider, type TypstNodeSpec, type VisualEditorContributions, type VisualEditorMenuContext } from '../../../hosts/visual-editor/visual-editor';
import type { MenuItem } from '../../../hosts/commands/commands';
import type { ExtensionContext } from '../../../hosts/workbench/workbench';
import { describeLabel } from '../model/label-description';
import { insertReference } from './label-edits';
import { captionLabels } from './caption-labels';
import { canStartNewLabel, editLabel, hasLabel, labelTags, startNewLabel, type LabelPrompts } from './label-tags';
import { referenceHints } from './reference-hints';
import { Reference } from './reference-node';

/** `@key` chips with hints, label tags on blocks, the `@` list of labels. */
export function registerReferences(visualEditor: VisualEditorContributions, options: ReferencesOptions): Disposable {
  const { labels, prompts } = options;
  return Disposable.from(
    visualEditor.registerNode(REFERENCE),
    visualEditor.registerTiptapExtension((editor) => referencesExtension(labels, editor.document, prompts)),
    visualEditor.registerCompletionItemProvider(labelCompletions(labels), { char: '@', allowedPrefixes: [' ', '\u00a0', '(', '[', '{'] }),
  );
}

/**
 * "Add label" (in the Insert menu and, where the selection's block can take a label, in the selection's bar) and
 * "Label" in the bar above a selected image (add, rename, remove).
 */
export function registerLabelButtons({ commands, workbench }: Pick<ExtensionContext, 'commands' | 'workbench'>, options: ReferencesOptions): Disposable {
  return Disposable.from(
    commands.registerCommand(ADD_LABEL, ({ tiptap }: VisualEditorMenuContext) => startNewLabel(tiptap.view)),
    commands.registerCommand(EDIT_LABEL, ({ tiptap, document }: VisualEditorMenuContext) => editLabel(tiptap.view, { ...options, document })),
    workbench.registerMenuItem('visualEditor/insert', { ...ADD_LABEL_BUTTON, order: 80 }),
    // after the marks and the link, before the comment (50); only where it applies, so the bar stays small
    workbench.registerMenuItem('visualEditor/selection', { ...ADD_LABEL_BUTTON, order: 45, when: ADD_LABEL_BUTTON.enabled }),
    // the images extension's bar above a selected image (an extension that is left out takes the bar along)
    workbench.registerMenuItem<VisualEditorMenuContext>('visualEditor/image', {
      command: EDIT_LABEL,
      title: 'Label',
      icon: ICON,
      order: 15,
      toggled: ({ tiptap }) => hasLabel(tiptap.state),
    }),
  );
}

export interface ReferencesOptions {
  /**
   * The project's labels: typing `@` offers them, reference chips show what they point to (or that the label is
   * missing), and a label can be renamed with its references in every file.
   */
  labels: ProjectLabels;
  /** Where a label tag asks what to do and for the new name: the window's quick pick and input box. */
  prompts: LabelPrompts;
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

/** The plugins of one editor: reference hints, label tags, labels named after captions. */
function referencesExtension(labels: ProjectLabels, document: TypstDocument, prompts: LabelPrompts): Extension {
  return Extension.create({
    name: 'typstReferences',
    addProseMirrorPlugins() {
      return [referenceHints(labels), labelTags({ labels, document, prompts }), captionLabels(labels)];
    },
  });
}

/**
 * The `@` list: the project's labels (each name once), found by name or by what they label; choosing one inserts a
 * reference chip in place of `@query`.
 */
function labelCompletions(labels: ProjectLabels): CompletionItemProvider {
  return {
    provideCompletionItems({ query }) {
      const seen = new Set<string>();
      const unique = labels.labels().filter((label) => !seen.has(label.name) && seen.add(label.name));
      return unique.map((label): CompletionItem => ({
        label: label.name,
        detail: describeLabel(label) ?? undefined,
        keywords: label.title ? [label.title] : undefined,
        // `.` and `:` may go on with a longer name (`@fig` + `:` → `@fig:x`)
        commitCharacters: label.name === query ? ENDS_REFERENCE.filter((c) => ![...seen].some((name) => name.startsWith(label.name + c))) : undefined,
        command: ({ tiptap, range }) => {
          tiptap.view.dispatch(insertReference(tiptap.state, range, label.name));
          tiptap.view.focus();
        },
      }));
    },
  };
}

/** Typed right after `@name`, the whole name of a label, these make it a reference, too: `@intro ` like choosing `intro`. */
const ENDS_REFERENCE = [' ', '\u00a0', ',', ';', '!', '?', ')', ']', '.', ':'];

const ICON = svg('<path d="M3 12V4h8l9 8-8 8z"/><circle cx="7.5" cy="8.5" r="1.2"/>');

/** Starts a new label on the block of the selection of the menu's editor ("Add label"). */
const ADD_LABEL = 'labels.addLabel';
/** Adds, renames or removes the label of the selected image's figure ("Label"). */
const EDIT_LABEL = 'labels.editLabel';

/**
 * "Add label": a label (`<fig:logo>`) on the figure or block the selection is in, typed into a draft tag
 * right where it will show (starting with `fig:`, `tab:` or `sec:` as is customary). Enabled where that
 * block has none yet; an existing label is renamed or removed through its tag.
 */
const ADD_LABEL_BUTTON: MenuItem<VisualEditorMenuContext> = {
  command: ADD_LABEL,
  title: 'Add label',
  icon: ICON,
  keywords: ['anchor', 'reference'],
  enabled: ({ tiptap }) => canStartNewLabel(tiptap.state) !== null,
};
