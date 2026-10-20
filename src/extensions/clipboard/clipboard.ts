import type { TypstDocument } from '../../core/typst-document/typst-document';
import type { TextDocument } from '../../hosts/languages/languages';
import type { Extension } from '../../hosts/workbench/workbench';
import css from './clipboard.css?inline';
import { PasteAs } from './paste-as';
import { TYPST_PASTE_METADATA, TypstPasteEditProvider } from './pasted-typst';
import { pasteExtension } from './source-editor/paste-extension';
import { typstClipboard } from './visual-editor/clipboard';

/**
 * Copy and paste of Typst in the Visual and the Source editors, through the paste edit providers of Typst
 * (`languages.registerDocumentPasteEditProvider`; its own offers the text as Typst, code as a code block, plain text
 * escaped). The Visual editor copies the selection's Typst; a paste goes in as the first edit on offer, and the
 * "Paste as" chip above it (Mod+., the command `editor.action.pasteAs({ kind? })`, VS Code's) switches it to another,
 * in one undo step. Mod+Shift+V pastes plain text in the Visual editor; the Source editors paste as Typst first.
 *
 * Without it, the editors copy and paste as ProseMirror and CodeMirror do (the Visual editor: the text as characters,
 * HTML by the schema's rules), and no provider takes part.
 */
export function clipboard(): Extension {
  return {
    id: 'clipboard',
    activate({ project, languages, window, commands, workbench, visualEditor, sourceEditor, subscriptions }) {
      const choices = new PasteAs(window);
      const textOf = (document: TypstDocument) => (): TextDocument | null => {
        const path = project.pathOf(document);
        return path ? { path, languageId: 'typst', text: document.text } : null;
      };
      subscriptions.push(
        workbench.registerStyleSheet(css),
        // priority 0: its edits after the other providers' (default 100)
        languages.registerDocumentPasteEditProvider({ language: 'typst' }, new TypstPasteEditProvider(), TYPST_PASTE_METADATA, { priority: 0 }),
        visualEditor.registerTiptapExtension(({ document }) => typstClipboard(document, { languages, document: textOf(document), choices })),
        // a paste goes in as CodeMirror pastes it (the text as Typst) first
        sourceEditor.registerCodeMirrorExtension({ editor: 'source' }, (editor) => {
          if (editor.editor !== 'source') return [];
          return pasteExtension(languages, 'typst', () => project.pathOf(editor.document) ?? null, { preferences: ['typst'], choices });
        }),
        commands.registerCommand('editor.action.pasteAs', (args?: { kind?: string }) => choices.pasteAs(args)),
      );
    },
  };
}
