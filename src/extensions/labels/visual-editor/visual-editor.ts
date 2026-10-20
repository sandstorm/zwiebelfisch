// References and labels in the Visual editor. See labels in ../labels.ts.
import { Extension } from '@tiptap/core';
import { Disposable } from '../../../core/disposable/disposable';
import type { TypstDocument } from '../../../core/typst-document/typst-document';
import { guardAfterReference, referenceSyntax } from '../model/reference-syntax';
import type { ProjectLabels } from '../model/label-index';
import { svg, type CompletionItem, type CompletionItemProvider, type ToolbarAction, type ToolbarContext, type TypstNodeSpec, type VisualEditorContributions } from '../../../hosts/visual-editor/visual-editor';
import { describeLabel } from '../model/label-description';
import { insertReference } from './label-edits';
import { captionLabels } from './caption-labels';
import { canStartNewLabel, editLabel, hasLabel, labelTags, startNewLabel, type LabelPrompts } from './label-tags';
import { referenceHints } from './reference-hints';
import { Reference } from './reference-node';

/**
 * `@key` chips with hints, label tags on blocks, the `@` list of labels, "Label" in the bar above a selected image
 * (add, rename, remove), and "Add label" (in the Insert menu and, where
 * the selection's block can take a label, in the selection's bar).
 */
export function registerReferences(visualEditor: VisualEditorContributions, options: ReferencesOptions): Disposable {
  const { labels, prompts } = options;
  return Disposable.from(
    visualEditor.registerNode(REFERENCE),
    visualEditor.registerTiptapExtension((editor) => referencesExtension(labels, editor.document, prompts)),
    visualEditor.registerCompletionItemProvider(labelCompletions(labels), { char: '@', allowedPrefixes: [' ', '\u00a0', '(', '[', '{'] }),
    visualEditor.registerToolbarItem({ group: 'insert', order: 80, create: addLabel }),
    // after the marks and the link, before the comment (50)
    visualEditor.registerToolbarItem({ group: 'selection', order: 45, create: (toolbar) => onlyWhereEnabled(addLabel(toolbar)) }),
    // the images extension's bar above a selected image (an extension that is left out takes the bar along)
    visualEditor.registerToolbarItem({ group: 'image', order: 15, create: (toolbar) => figureLabel(toolbar, options) }),
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
        command: ({ editor, range }) => {
          editor.view.dispatch(insertReference(editor.state, range, label.name));
          editor.view.focus();
        },
      }));
    },
  };
}

/** Typed right after `@name`, the whole name of a label, these make it a reference, too: `@intro ` like choosing `intro`. */
const ENDS_REFERENCE = [' ', '\u00a0', ',', ';', '!', '?', ')', ']', '.', ':'];

/**
 * "Add label": a label (`<fig:logo>`) on the figure or block the selection is in, typed into a draft tag
 * right where it will show (starting with `fig:`, `tab:` or `sec:` as is customary). Enabled where that
 * block has none yet; an existing label is renamed or removed through its tag.
 */
function addLabel(toolbar: ToolbarContext): ToolbarAction {
  return {
    label: 'Add label',
    icon: ICON,
    keywords: ['anchor', 'reference'],
    run: (c) => c,
    enabled: (editor) => canStartNewLabel(editor.state) !== null,
    click: () => startNewLabel(toolbar.editor.view),
  };
}

/** "Label" in the bar above a selected image: adds the label of its figure (or the image), or renames or removes it. */
function figureLabel(toolbar: ToolbarContext, { labels, prompts }: ReferencesOptions): ToolbarAction {
  return {
    label: 'Label',
    icon: ICON,
    click: () => editLabel(toolbar.editor.view, { labels, document: toolbar.document, prompts }),
    active: (editor) => hasLabel(editor.state),
  };
}

const ICON = svg('<path d="M3 12V4h8l9 8-8 8z"/><circle cx="7.5" cy="8.5" r="1.2"/>');

/**
 * The selection bar's "Add label": shown only where it applies, so the bar stays small; a block's existing
 * label is renamed or removed through its tag, right next to the selection.
 */
function onlyWhereEnabled(action: ToolbarAction): ToolbarAction {
  return { ...action, visible: action.enabled };
}
