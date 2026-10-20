// What the math extension contributes to the Visual editor. See math in ../math.ts.
import { Extension, InputRule } from '@tiptap/core';
import type { Node, ResolvedPos } from '@tiptap/pm/model';
import { Selection, TextSelection, type Transaction } from '@tiptap/pm/state';
import { Disposable } from '../../../core/disposable/disposable';
import { svg, type VisualEditorMenuContext } from '../../../hosts/visual-editor/visual-editor';
import type { ExtensionContext } from '../../../hosts/workbench/workbench';

/**
 * The closing `$` of `$…$` typed in the text: the opening `$` not after a backslash or another `$`, something between
 * them. Whether it is math (spaces on both sides or none, not an escaped `\$`) the handler decides.
 */
const MATH_INPUT = /(?:^|[^\\$])(\$([^$]+)\$)$/;

/** Typing `$…$` makes the raw box the parser makes for math (`typedMath`); Backspace right after gives the text back. */
export const MathInput = Extension.create({
  name: 'typstMathInput',
  addInputRules() {
    return [new InputRule({ find: MATH_INPUT, handler: ({ state, range, match }) => (typedMath(state.tr, range.to, match[1], match[2]) ? undefined : null) })];
  },
});

/**
 * Insert → "Inline math": a `$$` box at the cursor, its code edited between the dollars; "Display math": a `$  $`
 * block box after the cursor's paragraph (instead of an empty one), its code edited inside. Found by the slash
 * commands as math, equation, formula.
 */
export function registerInsertMath({ commands, window }: Pick<ExtensionContext, 'commands' | 'window'>): Disposable {
  const inline = { type: 'rawInline', attrs: { src: '$$' } };
  const display = { type: 'rawBlock', attrs: { src: '$  $' } };
  return Disposable.from(
    commands.registerCommand(INLINE_MATH, ({ tiptap }: VisualEditorMenuContext) => {
      if (!tiptap.chain().focus().insertContent(inline).run()) return;
      const { $from } = tiptap.state.selection;
      if ($from.nodeBefore?.type.name === 'rawInline') tiptap.commands.editRawBox($from.pos - $from.nodeBefore.nodeSize, 1);
    }),
    commands.registerCommand(DISPLAY_MATH, ({ tiptap }: VisualEditorMenuContext) => {
      const at = besideTextblock(tiptap.state.selection.$to);
      if (tiptap.chain().focus().insertContentAt(at, display).run()) tiptap.commands.editRawBox(at.from, 2);
    }),
    window.registerMenuItem<VisualEditorMenuContext>('visualEditor/insert', {
      command: INLINE_MATH,
      title: 'Inline math',
      icon: ICONS.inline,
      keywords: ['math', 'equation', 'formula', 'inline'],
      order: 44,
      enabled: ({ tiptap }) => tiptap.can().insertContent(inline),
    }),
    window.registerMenuItem<VisualEditorMenuContext>('visualEditor/insert', {
      command: DISPLAY_MATH,
      title: 'Display math',
      icon: ICONS.display,
      keywords: ['math', 'equation', 'formula', 'block'],
      order: 46,
      enabled: ({ tiptap }) => tiptap.can().insertContentAt(besideTextblock(tiptap.state.selection.$to), display),
    }),
  );
}

const INLINE_MATH = 'math.insertInlineMath';
const DISPLAY_MATH = 'math.insertDisplayMath';

/**
 * Makes `typed` (`$…$`, ending at `end`, `content` between the dollars) the raw box the parser makes for it, in `tr`:
 * display math (spaces inside both dollars) alone in a paragraph replaces it with a block box, else an inline box
 * takes the typed text's place. False (stays text) for anything else: a space on one side only (`$5 and $`), an
 * escaped `\$` at either end, a box or break inside.
 */
function typedMath(tr: Transaction, end: number, typed: string, content: string): boolean {
  const start = end - typed.length;
  const lead = /^\s/.test(content);
  if (content.trim() === '' || content.endsWith('\\') || lead !== /\s$/.test(content)) return false;
  if (start < 0 || tr.doc.textBetween(start, end, undefined, '\ufffc') !== typed) return false;
  const opening = tr.doc.nodeAt(start)!;
  if (opening.marks.some((mark) => mark.type.name === 'typstSource')) return false;
  const $start = tr.doc.resolve(start);
  if (lead && isWholeParagraph($start, end)) displayBox(tr, $start, typed);
  else tr.replaceWith(start, end, tr.doc.type.schema.nodes.rawInline.create({ src: typed }, null, opening.marks));
  return true;
}

/** Whether `$start`..`end` is all of a paragraph's content, and a block box may take the paragraph's place. */
function isWholeParagraph($start: ResolvedPos, end: number): boolean {
  const paragraph = $start.parent;
  if (paragraph.type.name !== 'paragraph' || $start.pos !== $start.start() || end !== $start.end()) return false;
  const index = $start.index(-1);
  return $start.node(-1).canReplaceWith(index, index + 1, $start.doc.type.schema.nodes.rawBlock);
}

/** Replaces the paragraph at `$start` with a block box of `src`; the cursor goes to the text after it (a new paragraph if none). */
function displayBox(tr: Transaction, $start: ResolvedPos, src: string): void {
  const { schema } = tr.doc.type;
  const before = $start.before();
  const box: Node = schema.nodes.rawBlock.create({ src, sep: $start.parent.attrs.sep });
  tr.replaceWith(before, $start.after(), box);
  const after = before + box.nodeSize;
  const next = Selection.findFrom(tr.doc.resolve(after), 1, true);
  if (next instanceof TextSelection && next.from === after + 1) {
    tr.setSelection(next);
    return;
  }
  tr.insert(after, schema.nodes.paragraph.create());
  tr.setSelection(TextSelection.create(tr.doc, after + 1));
}

/** Where a block goes for `$pos`: in place of its empty textblock, else after it (or right there outside one). */
function besideTextblock($pos: ResolvedPos): { from: number; to: number } {
  if (!$pos.parent.isTextblock || $pos.depth === 0) return { from: $pos.pos, to: $pos.pos };
  const after = $pos.after();
  return $pos.parent.content.size === 0 ? { from: $pos.before(), to: after } : { from: after, to: after };
}

const ICONS = {
  inline: svg('<path d="M17 5H7l6 7-6 7h10"/>'),
  display: svg('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 7.5H9l3.5 4.5L9 16.5h6"/>'),
};
