// Stateless helpers of the Visual editor host, for whoever holds a Tiptap editor of it. See visual-editor.ts.
import type { ChainedCommands, Editor } from '@tiptap/core';
import type { ResolvedPos } from '@tiptap/pm/model';
import { NodeSelection, type Selection } from '@tiptap/pm/state';
import { SourceOffset, type TextChange } from '../../core/typst-document/typst-document';
import { applyTypstChanges, parseTypst, posToSource, serializeToTypst } from './typst-conversion/typst-conversion';
import { Disposable } from '../../core/disposable/disposable';
import type { Commands, MenuItem } from '../commands/commands';
import type { ChainButton, VisualEditorMenuContext } from './visual-editor';

/**
 * Inserts what Typst `source` is read as in the Tiptap `editor` (as the Visual editor reads any Typst: a figure of an
 * image is a figure, what no spec models a raw box), at the selection or at document position `at` (where something was
 * dropped). One paragraph's inline content (`*bold*`, `$x$`) goes into the text there, in place of the selection;
 * blocks go next to it: after the selected block, or after the paragraph or heading holding the position, an empty
 * paragraph taken over. Blocks never split or replace anything. `changes` of the editor's Typst (in its coordinates
 * before the insert, e.g. the import `source` needs) go into the same transaction, so one undo takes back both. The
 * editor gets the focus, the cursor after what was inserted. For an entry whose result is easier written as Typst than
 * built as nodes (Insert entries, drops, help snippets).
 *
 * @helper Stateless: no registry, no per-widget state.
 */
export function insertTypst(editor: Editor, source: string, at?: number, changes: readonly TextChange[] = []): void {
  const { schema } = editor.state;
  const content = parseTypst(source, schema).content;
  const paragraph = content.childCount === 1 && content.firstChild!.type === schema.nodes.paragraph ? content.firstChild! : null;
  editor
    .chain()
    .focus()
    .command(({ tr, commands }) => {
      const { selection, doc } = tr;
      const $at = at === undefined ? selection.$to : doc.resolve(Math.min(at, doc.content.size));
      const inline = paragraph !== null && $at.parent.inlineContent;
      const range = insertionRange(at === undefined ? selection : null, $at, inline);
      const edge = posToSource(doc, range.from);
      const before = serializeToTypst(doc).length;
      if (!commands.insertContentAt(range, inline ? paragraph.content : content)) return false;
      if (changes.length === 0) return true;
      // the changes go in after the insert: a fresh parse of the text before it has no empty paragraph to take over
      const text = serializeToTypst(tr.doc);
      applyTypstChanges(tr, parseTypst(applyChanges(text, shiftedPast(changes, edge, text.length - before)), schema));
      return true;
    })
    .run();
}

/**
 * Where `insertTypst` puts inline content (`inline`): in place of `selection`, else (a position given) at `$at`; where
 * blocks: after the selected block, else beside the text block of `$at`.
 */
function insertionRange(selection: Selection | null, $at: ResolvedPos, inline: boolean): { from: number; to: number } {
  if (inline) return selection ? { from: selection.from, to: selection.to } : { from: $at.pos, to: $at.pos };
  return selection instanceof NodeSelection && selection.node.isBlock ? { from: $at.pos, to: $at.pos } : besideTextblock($at);
}

/** `changes` with those after source offset `edge` moved by `delta` (what an edit at `edge` added). */
function shiftedPast(changes: readonly TextChange[], edge: SourceOffset, delta: number): TextChange[] {
  return changes.map((change) => (change.to <= edge ? change : { ...change, from: SourceOffset.of(change.from + delta), to: SourceOffset.of(change.to + delta) }));
}

/** `text` with `changes` (in its coordinates, not overlapping) applied. Also `VisualEditor.edit`'s. */
export function applyChanges(text: string, changes: readonly TextChange[]): string {
  return [...changes].sort((a, b) => b.from - a.from).reduce((current, { from, to, insert }) => current.slice(0, from) + insert + current.slice(to), text);
}

/** Where blocks go for `$pos`: after its textblock (instead of an empty one), else right there. */
function besideTextblock($pos: ResolvedPos): { from: number; to: number } {
  if (!$pos.parent.isTextblock || $pos.depth === 0) return { from: $pos.pos, to: $pos.pos };
  const after = $pos.after();
  return $pos.parent.content.size === 0 ? { from: $pos.before(), to: after } : { from: after, to: after };
}

/**
 * A toolbar icon: 24×24 outline strokes in the text colour.
 *
 * @helper Stateless: no registry, no per-widget state.
 */
export function svg(body: string): string {
  return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

/**
 * A Visual editor menu entry's command from a Tiptap chain: `run` (the command's handler) runs `chain` on the menu's
 * editor, focused; `enabled` (the entry's) is its dry run there, so the button is disabled where the chain cannot
 * apply.
 *
 * @helper Stateless: no registry, no per-widget state.
 */
export function chainCommand(chain: (chain: ChainedCommands) => ChainedCommands): {
  run(context: VisualEditorMenuContext): boolean;
  enabled(context: VisualEditorMenuContext): boolean;
} {
  return {
    run: ({ editor }) => chain(editor.chain().focus()).run(),
    enabled: ({ editor }) => chain(editor.can().chain()).run(),
  };
}

/**
 * Registers `button` as an entry of the Visual editor menu `menuId` and its command (`chainCommand(button.chain)`),
 * until disposed: for a button that only runs a Tiptap chain (Bold, Undo, Insert table).
 *
 * @helper Stateless: no registry, no per-widget state.
 */
export function registerChainButton(
  { commands, workbench }: { commands: Pick<Commands, 'registerCommand'>; workbench: { registerMenuItem(menuId: string, item: MenuItem<VisualEditorMenuContext>): Disposable } },
  menuId: string,
  button: ChainButton,
): Disposable {
  const { chain, ...item } = button;
  const { run, enabled } = chainCommand(chain);
  return Disposable.from(commands.registerCommand(item.command, run), workbench.registerMenuItem(menuId, { ...item, enabled }));
}
