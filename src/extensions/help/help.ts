import type { ExtensionContext, TypstExtension } from '../../hosts/workbench/workbench';
import css from './help.css?inline';
import { snippetDrops, TYPST_SNIPPET_TYPE } from './visual-editor/snippet-drops';
import { HelpPanel } from './workbench/help-panel';

/**
 * The left side panel "Help" (its rail button next to Files): the cheat sheets for the language of the shown file,
 * following the shown file ("No help for this file type" without any). A row is something to write. Dragged into an
 * editor, it lands where it is dropped (the Source and text editors take it as text; the Visual editor reads a Typst
 * row as Typst). Enter puts it at the cursor of the shown Typst editor (`help.insertAtCursor`), or copies it while
 * another kind of file is shown. Its context menu (`help/row`) offers "Insert at cursor" and "Copy" (`help.copy`).
 *
 * The sheets are not here. A language's sheet belongs to its extension (`languages.registerHelpProvider`: Typst in
 * typst-language, Mermaid in mermaid, …). The panel only renders what `languages.provideHelp` gives for the shown
 * file's language, so a language brings its help without the panel knowing it. See docs/20_features/19_help.typ.
 */
export function help(): TypstExtension {
  return {
    id: 'help',
    activate(context) {
      const { window, languages, workbench, commands, visualEditor, subscriptions } = context;
      const side = workbench.registerSidePanel('help', { label: 'Help', icon: helpIcon(workbench.ownerDocument), order: 20 });
      const panel = new HelpPanel(side.body, {
        insert: (text) => void commands.executeCommand(INSERT, text),
        showContextMenu: (text, anchor, title) => window.showContextMenu(ROW_MENU, { anchor, title, args: [text] }),
      });
      const render = () => {
        const languageId = languages.getLanguageId(window.activeFile);
        // only a Typst row is read as Typst where it is dropped (the Visual editor)
        panel.render(languages.provideHelp(languageId), languageId === 'typst' ? ['text/plain', TYPST_SNIPPET_TYPE] : ['text/plain']);
      };
      render();
      subscriptions.push(
        workbench.registerStyleSheet(css),
        side,
        commands.registerCommand(INSERT, (text: string) => insertAtCursor(context, text)),
        commands.registerCommand(COPY, (text: string) => copy(context, text)),
        workbench.registerMenuItem(ROW_MENU, { command: INSERT, title: 'Insert at cursor', order: 10, when: () => window.activeTextEditor !== null }),
        workbench.registerMenuItem(ROW_MENU, { command: COPY, title: 'Copy', order: 20 }),
        visualEditor.registerTiptapExtension(() => snippetDrops()),
        window.onDidChangeActiveFile(render),
      );
    },
  };
}

/** The menu of a help row (`window.showContextMenu`; its commands get the text the row inserts). */
const ROW_MENU = 'help/row';
const INSERT = 'help.insertAtCursor';
const COPY = 'help.copy';

/** The rail button's icon: a question mark in a circle. */
function helpIcon(doc: Document): SVGSVGElement {
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.3');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = '<circle cx="8" cy="8" r="6.5"/><path d="M6.2 6.2a1.9 1.9 0 1 1 2.6 1.75c-.5.22-.8.6-.8 1.15v.4"/><path d="M8 11.6v.1"/>';
  return svg;
}

/** Puts `text` at the cursor of the shown Typst editor; with no Typst editor shown, copies it (and says so). */
function insertAtCursor(context: ExtensionContext, text: string): Promise<void> | void {
  const editor = context.window.activeTextEditor;
  if (editor) editor.insertSnippet(text);
  else return copy(context, text, 'Copied: no editor here takes it at the cursor; paste it, or drag the row into the text.');
}

/** Copies `text` to the clipboard and says so (`message`); a refusal (no permission) is an error message. */
async function copy({ window, workbench }: ExtensionContext, text: string, message = 'Copied.'): Promise<void> {
  try {
    await workbench.ownerDocument.defaultView!.navigator.clipboard.writeText(text);
    void window.showInformationMessage(message);
  } catch {
    void window.showErrorMessage('The clipboard could not be written: drag the row into the text instead.');
  }
}
