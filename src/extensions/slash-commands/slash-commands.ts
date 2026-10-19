import { Extension as TiptapExtension, type Editor } from '@tiptap/core';
import { Plugin, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { CompletionItem, CompletionItemProvider, TextStyle, ToolbarAction } from '../../hosts/visual-editor/visual-editor';
import type { Extension } from '../../hosts/workbench/workbench';
import css from './slash-commands.css?inline';

/**
 * Typing `/` in the Visual editor lists what can be done where the cursor is: the Insert menu's entries, the list and
 * alignment buttons and the text styles, found by label and keywords. Choosing one runs it as its menu would.
 *
 * The list holds whatever other extensions put into those menus. The empty paragraph holding the cursor shows the hint
 * "Type / for commands" (not in table cells).
 */
export function slashCommands(): Extension {
  return {
    id: 'slash-commands',
    activate({ workbench, visualEditor, subscriptions }) {
      subscriptions.push(
        workbench.registerStyleSheet(css),
        visualEditor.registerCompletionItemProvider(SLASH_COMMANDS, { char: '/' }),
        visualEditor.registerTiptapExtension(() => SlashCommandsHint),
      );
    },
  };
}

/**
 * The Insert menu's entries, the list and alignment buttons, then the text style menu's, that are enabled where the
 * cursor is; found by label and keywords. Choosing one removes the `/query` and runs it as its menu would.
 */
const SLASH_COMMANDS: CompletionItemProvider = {
  provideCompletionItems: ({ editor, toolbarActions, textStyles }) => [
    ...SLASH_GROUPS.flatMap(([group, detail]) =>
      toolbarActions(group)
        .filter((action) => actionEnabled(action, editor))
        .map((action) => toolbarItem(action, detail)),
    ),
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

/** The toolbar groups the slash list offers, and how a row names its group. */
const SLASH_GROUPS: readonly (readonly [group: string, detail: string])[] = [
  ['insert', 'Insert'],
  ['lists', 'List'],
  ['align', 'Align'],
];

function toolbarItem(action: ToolbarAction, detail: string): CompletionItem {
  return {
    label: action.label,
    detail,
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

/**
 * A muted "Type / for commands" in the empty paragraph holding the cursor while the editor has focus (as Tiptap's
 * Placeholder with `showOnlyCurrent`): a node decoration whose `data-hint` CSS draws, so it is never document text.
 * Decorations are asked for with every state, including the focus and blur transactions Tiptap dispatches.
 */
const SlashCommandsHint = TiptapExtension.create({
  name: 'typstSlashCommandsHint',
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [new Plugin({ props: { decorations: (state) => (editor.isFocused && editor.isEditable ? hint(state) : null) } })];
  },
});

/** The hint on the selection's paragraph if it is empty; not in table cells, which are too narrow for it. */
function hint(state: EditorState): DecorationSet | null {
  const { selection } = state;
  const { $from } = selection;
  const paragraph = $from.parent;
  if (!selection.empty || paragraph.type.name !== 'paragraph' || paragraph.content.size > 0) return null;
  for (let depth = $from.depth - 1; depth > 0; depth--) if ($from.node(depth).type.spec.tableRole) return null;
  const pos = $from.before();
  return DecorationSet.create(state.doc, [
    Decoration.node(pos, pos + paragraph.nodeSize, { class: 'zwf-slash-commands__hint', 'data-hint': 'Type / for commands' }),
  ]);
}
