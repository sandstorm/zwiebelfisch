// References and labels in the Visual view: `@key` chips, label tags on blocks, the `@` suggestion list.
// Entry of visual-view/references/. See ARCHITECTURE.md, "VisualView".
import { Extension } from '@tiptap/core';
import type { TypstDocument } from '../../../core/typst-document/typst-document';
import type { ProjectLabels } from '../../labels/labels';
import { labelTags } from './label-tags';
import { referenceHints } from './reference-hints';
import { referenceSuggestion } from './reference-suggestion';

export { Reference } from './reference-node';

/**
 * How the Visual view of `document` shows and edits references and labels:
 * label tags (rename, remove), and — with the project's `labels` — hints on
 * reference chips (what they point to, or that the label is missing) and the
 * `@` list of labels to insert references from. Without `labels`, only the
 * tags (renaming just the label).
 */
export function referencesExtension({ labels, document }: { labels?: ProjectLabels; document?: TypstDocument }): Extension {
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
