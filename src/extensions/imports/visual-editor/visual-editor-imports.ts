// The imports extension in the Visual editor. See imports in ../imports.ts.
import { Extension, type AnyExtension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import type { TypstDocument } from '../../../core/typst-document/typst-document';
import { applyTypstChanges, parseTypst, serializeToTypst } from '../../../hosts/prosemirror-typst/prosemirror-typst';
import { addCopyListener, type ImportsClipboard } from '../imports';
import type { CopiedImport } from '../model/pasted-imports';

/**
 * Copies from the editor (its raw boxes too) carry the imports they use; a paste gets the imports it needs, in a
 * transaction appended to the paste's, so one undo takes back both. The imports are text changes at the top of the
 * source, applied as any change of the text is (`applyTypstChanges` of the changed text read again).
 */
export function visualEditorImports(document: TypstDocument, clipboard: ImportsClipboard): AnyExtension {
  return Extension.create({
    name: 'pasteImports',
    addProseMirrorPlugins() {
      // what the clipboard of the paste being dispatched brought; null: no paste
      let pasted: CopiedImport[] | null = null;
      return [
        new Plugin({
          view: (view) => ({ destroy: addCopyListener(view.dom, document, clipboard) }),
          props: {
            handleDOMEvents: {
              paste: (_view, event) => {
                pasted = event.clipboardData ? clipboard.paste(event.clipboardData) : [];
                return false;
              },
            },
          },
          appendTransaction: (transactions, before, after) => {
            const copied = pasted;
            if (copied === null || !transactions.some((tr) => tr.getMeta('uiEvent') === 'paste')) return null;
            pasted = null;
            const text = serializeToTypst(after.doc);
            const changes = clipboard.changes(document, serializeToTypst(before.doc), text, copied);
            if (changes.length === 0) return null;
            const imported = changes.reduce((current, { from, to, insert }) => current.slice(0, from) + insert + current.slice(to), text);
            return applyTypstChanges(after.tr, parseTypst(imported, after.schema));
          },
        }),
      ];
    },
  });
}
