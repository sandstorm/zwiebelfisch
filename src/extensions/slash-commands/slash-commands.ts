// The slash-commands extension: `/` at a line start or after a space lists what the Visual view's Insert menu and
// text style menu offer. Entry of extensions/slash-commands/. Why an extension: it only reads what other extensions
// register (through the host's completion context), so the list grows with them and it can be left out. See
// docs/guide/features.typ.
import type { Editor } from '@tiptap/core';
import type { CompletionItem, CompletionItemProvider, TextStyle, ToolbarAction } from '../../hosts/visual-view/visual-view';
import type { TypstExtension } from '../../hosts/workbench/workbench';

/** Typing `/` offers the Insert menu's entries and the text styles that can apply here. */
export function slashCommands(): TypstExtension {
  return {
    id: 'slash-commands',
    activate({ visualView, subscriptions }) {
      subscriptions.push(visualView.registerCompletionItemProvider(SLASH_COMMANDS, { char: '/' }));
    },
  };
}

/**
 * The Insert menu's entries, then the text style menu's, that are enabled where the cursor is; found by label and
 * keywords. Choosing one removes the `/query` and runs it as its menu would.
 */
const SLASH_COMMANDS: CompletionItemProvider = {
  provideCompletionItems: ({ editor, toolbarActions, textStyles }) => [
    ...toolbarActions('insert')
      .filter((action) => actionEnabled(action, editor))
      .map(insertItem),
    ...textStyles()
      .filter((style) => (style.enabled ? style.enabled(editor) : style.apply(editor.can().chain(), editor).run()))
      .map(textStyleItem),
  ],
};

/** As the toolbar decides: `enabled`, else the dry run of `run`, else enabled. */
function actionEnabled(action: ToolbarAction, editor: Editor): boolean {
  if (action.enabled) return action.enabled(editor);
  return action.run ? action.run(editor.can().chain()).run() : true;
}

function insertItem(action: ToolbarAction): CompletionItem {
  return {
    label: action.label,
    detail: 'Insert',
    icon: action.icon,
    keywords: action.keywords,
    command: ({ editor, range }) => {
      const chain = editor.chain().focus().deleteRange(range);
      // as its button: `click` (asking first) instead of `run`
      if (action.click || !action.run) {
        chain.run();
        action.click?.();
      } else {
        action.run(chain).run();
      }
    },
  };
}

function textStyleItem(style: TextStyle): CompletionItem {
  return {
    label: style.label,
    detail: style.section ?? 'Text style',
    keywords: style.keywords,
    command: ({ editor, range }) => {
      style.apply(editor.chain().focus().deleteRange(range), editor).run();
      style.applied?.();
    },
  };
}
