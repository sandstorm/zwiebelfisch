import type { ExtensionContext, Extension } from '../../hosts/extension-host/extension-host';
import css from './help.css?inline';
import { snippetDrops, TYPST_SNIPPET_TYPE } from './visual-editor/snippet-drops';
import { HelpPanel } from './workbench/help-panel';

/**
 * The "Help" side panel: the cheat sheets for the language of the shown file.
 * The sheets come from the language extensions (`languages.registerHelpSheet`).
 *
 * A row is something to write:
 * - dragged into an editor, it lands where it is dropped (the Visual editor reads a Typst row as Typst)
 * - Enter puts it at the cursor of the shown Typst editor (`help.insertAtCursor`), or copies it when no such editor is
 *   shown
 * - its context menu (`help/row`) offers "Insert at cursor" and "Copy" (`help.copy`)
 */
export function help(): Extension {
  return {
    id: 'help',
    activate(context) {
      const { window, languages, commands, visualEditor, subscriptions } = context;
      const side = window.registerSidePanel('help', { label: 'Help', icon: HELP_ICON, order: 20 });
      const panel = new HelpPanel(side.body, {
        insert: (text) => void commands.executeCommand(INSERT, text),
        showContextMenu: (text, anchor, title) => window.showContextMenu(ROW_MENU, { anchor, title, args: [text] }),
      });
      const render = () => {
        const languageId = languages.getLanguageId(window.activeFile);
        // only a Typst row is read as Typst where it is dropped (the Visual editor)
        panel.render(languages.getHelpSheets(languageId), languageId === 'typst' ? ['text/plain', TYPST_SNIPPET_TYPE] : ['text/plain']);
      };
      render();
      subscriptions.push(
        window.registerStyleSheet(css),
        side,
        commands.registerCommand(INSERT, (text: string) => insertAtCursor(context, text)),
        commands.registerCommand(COPY, (text: string) => copy(context, text)),
        window.registerMenuItem(ROW_MENU, { command: INSERT, title: 'Insert at cursor', order: 10, when: () => window.activeTextEditor !== null }),
        window.registerMenuItem(ROW_MENU, { command: COPY, title: 'Copy', order: 20 }),
        visualEditor.registerTiptapExtension(snippetDrops()),
        window.onDidChangeActiveFile(render),
      );
    },
  };
}

/** The menu of a help row (`window.showContextMenu`; its commands get the text the row inserts). */
const ROW_MENU = 'help/row';
const INSERT = 'help.insertAtCursor';
const COPY = 'help.copy';

/** Puts `text` at the cursor of the shown Typst editor; with no Typst editor shown, copies it (and says so). */
function insertAtCursor(context: ExtensionContext, text: string): Promise<void> | void {
  const editor = context.window.activeTextEditor;
  if (editor) editor.insertSnippet(text);
  else return copy(context, text, 'Copied: no editor here takes it at the cursor; paste it, or drag the row into the text.');
}

/** Copies `text` to the clipboard and says so (`message`); a refusal (no permission) is an error message. */
async function copy({ window }: ExtensionContext, text: string, message = 'Copied.'): Promise<void> {
  try {
    await window.ownerDocument.defaultView!.navigator.clipboard.writeText(text);
    void window.showInformationMessage(message);
  } catch {
    void window.showErrorMessage('The clipboard could not be written: drag the row into the text instead.');
  }
}

/** The rail button's icon: a question mark in a circle. */
const HELP_ICON =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="6.5"/><path d="M6.2 6.2a1.9 1.9 0 1 1 2.6 1.75c-.5.22-.8.6-.8 1.15v.4"/><path d="M8 11.6v.1"/></svg>';
