import { Extension as TiptapExtension } from '@tiptap/core';
import { Plugin, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Commands, MenuItem } from '../../hosts/commands/commands';
import type { CompletionItem, CompletionItemProvider, VisualEditorMenuContext } from '../../hosts/visual-editor/visual-editor';
import type { WindowApi } from '../../hosts/window/window';
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
    activate({ commands, window, visualEditor, subscriptions }) {
      subscriptions.push(
        window.registerStyleSheet(css),
        visualEditor.registerCompletionItemProvider(slashCommandItems(window, commands), { char: '/' }),
        visualEditor.registerTiptapExtension(SlashCommandsHint),
      );
    },
  };
}

/**
 * The Insert menu's entries, the list and alignment buttons, then the text style menu's, that are enabled where the
 * cursor is (the menus' entries as the window has them); found by label and keywords. Choosing one removes the
 * `/query` and runs it as its menu would.
 */
function slashCommandItems(window: Pick<WindowApi, 'getMenuItems'>, commands: Pick<Commands, 'executeCommand'>): CompletionItemProvider {
  return {
    provideCompletionItems: (context) => [
      ...SLASH_MENUS.flatMap(({ menuId, group, detail }) =>
        window
          .getMenuItems<VisualEditorMenuContext>(menuId, context)
          .filter((item) => (group === undefined || item.group === group) && (item.enabled?.(context) ?? true))
          .map((item) => menuItem(item, detail, context, commands)),
      ),
    ],
  };
}

/** The menus the slash list offers (of the row: one group), and how a row names its menu (unless the entry names its `category`). */
const SLASH_MENUS: readonly { readonly menuId: string; readonly group?: string; readonly detail: string }[] = [
  { menuId: 'visualEditor/insert', detail: 'Insert' },
  { menuId: 'visualEditor/toolbar', group: '3_lists', detail: 'List' },
  { menuId: 'visualEditor/align', detail: 'Align' },
  { menuId: 'visualEditor/textStyle', detail: 'Text style' },
];

function menuItem(item: MenuItem<VisualEditorMenuContext>, detail: string, context: VisualEditorMenuContext, commands: Pick<Commands, 'executeCommand'>): CompletionItem {
  return {
    label: item.title ?? item.command,
    detail: item.category ?? detail,
    icon: item.icon,
    keywords: item.keywords,
    command: ({ tiptap, range }) => {
      tiptap.chain().focus().deleteRange(range).run();
      commands.executeCommand(item.command, context).catch((error: unknown) => console.error(`Command ${item.command} failed:`, error));
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
