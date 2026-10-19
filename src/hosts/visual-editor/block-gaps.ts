// The caret between blocks. See VisualEditor in visual-editor-impl.ts.
import { Extension, type Editor } from '@tiptap/core';
import { Slice, type Node, type ResolvedPos } from '@tiptap/pm/model';
import { NodeSelection, Plugin, Selection, TextSelection, type EditorState } from '@tiptap/pm/state';
import type { Mappable } from '@tiptap/pm/transform';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import type { SourceOffset } from '../../core/typst-document/typst-document';
import { posToSource, sourceToPos } from '../prosemirror-typst/prosemirror-typst';

/**
 * A caret between blocks, as CKEditor 5 offers beside its widgets: before or after a box (a block that is no text block,
 * like a block style, a figure, a table, a raw box, or a code block), so one can go behind it and see whether the caret
 * is inside the block or after it. Only where a paragraph may go, never inside a list item.
 *
 * - Arrow keys stop at each gap; leaving a raw box's code lands in the gap beside it.
 * - At a gap, typing, Enter or a paste start a new paragraph there; Backspace selects the box before (a second one
 *   deletes it), Delete the box after.
 * - A click into the space between such blocks, or below the last one, puts the caret there.
 *
 * The gap is a selection of its own (`BlockGap`), mapped through every change; a caret revealed at its source offset is
 * the gap again. It replaces ProseMirror's gap cursor.
 */
export const BlockGaps = Extension.create({
  name: 'typstBlockGaps',
  // after the completion lists (1000), before the constructs' keys (a code block's ArrowUp/ArrowDown make a paragraph)
  priority: 500,
  addKeyboardShortcuts() {
    const arrow = (dir: Direction) => () => move(this.editor, dir);
    return {
      ArrowLeft: arrow('left'),
      ArrowRight: arrow('right'),
      ArrowUp: arrow('up'),
      ArrowDown: arrow('down'),
      Enter: () => insertParagraph(this.editor.view, ''),
      Backspace: () => selectBeside(this.editor.view, -1),
      Delete: () => selectBeside(this.editor.view, 1),
    };
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          decorations: drawGap,
          createSelectionBetween: (_view, $anchor, $head) => ($anchor.pos === $head.pos && isGap($head) ? new BlockGap($head) : null),
          handleClick: (view, _pos, event) => clickGap(view, event),
          handleTextInput: (view, _from, _to, text) => insertParagraph(view, text),
          handleDOMEvents: { beforeinput: (view, event) => startComposition(view, event) },
        },
      }),
    ];
  },
});

/** The caret in the gap at `$pos` (the edge of a raw box just left); null: no gap there. */
export function blockGapAt($pos: ResolvedPos): Selection | null {
  return isGap($pos) ? new BlockGap($pos) : null;
}

/**
 * The caret at source offset `offset` of `doc`'s source (revealed from the Source editor, or where the editor's own
 * selection there was): at the end of the text ending there (a paragraph's before a code block, whose gap has the
 * same offset); else in the gap whose offset it is, before the text block `offset` maps to or before the boxes it
 * starts; else in the text nearest.
 */
export function caretAtSource(doc: Node, offset: SourceOffset): Selection {
  const textEnd = sourceToPos(doc, offset, -1);
  if (doc.resolve(textEnd).parent.inlineContent && posToSource(doc, textEnd) === offset) return TextSelection.create(doc, textEnd);
  const $at = doc.resolve(sourceToPos(doc, offset));
  for (let $pos = $at; ; $pos = doc.resolve($pos.before())) {
    if (isGap($pos) && posToSource(doc, $pos.pos) === offset) return new BlockGap($pos);
    if ($pos.depth === 0 || $pos.parentOffset > 0) return TextSelection.between($at, $at);
  }
}

/** The caret in a gap between blocks: `$anchor` and `$head` are the gap's position. */
class BlockGap extends Selection {
  constructor($pos: ResolvedPos) {
    super($pos, $pos);
  }

  map(doc: Node, mapping: Mappable): Selection {
    return selectionAt(doc, mapping.map(this.head));
  }

  content(): Slice {
    return Slice.empty;
  }

  eq(other: Selection): boolean {
    return other instanceof BlockGap && other.head === this.head;
  }

  toJSON(): { type: string; pos: number } {
    return { type: 'blockGap', pos: this.head };
  }

  static fromJSON(doc: Node, json: { pos: unknown }): BlockGap {
    if (typeof json.pos !== 'number') throw new RangeError('Invalid input for BlockGap.fromJSON');
    return new BlockGap(doc.resolve(json.pos));
  }

  getBookmark(): { map(mapping: Mappable): ReturnType<BlockGap['getBookmark']>; resolve(doc: Node): Selection } {
    const at = (pos: number) => ({ map: (mapping: Mappable) => at(mapping.map(pos)), resolve: (doc: Node) => selectionAt(doc, pos) });
    return at(this.head);
  }
}
// no DOM selection: the decoration draws it
BlockGap.prototype.visible = false;
Selection.jsonID('blockGap', BlockGap);

/** The gap at `pos` of `doc`, or the nearest selection if there is none there (any more). */
function selectionAt(doc: Node, pos: number): Selection {
  const $pos = doc.resolve(pos);
  return blockGapAt($pos) ?? Selection.near($pos);
}

/** Whether `$pos` is a gap: beside a box, where a paragraph may go, not inside a list item. */
function isGap($pos: ResolvedPos): boolean {
  const { parent, depth } = $pos;
  if (parent.inlineContent || (depth > 0 && $pos.node(depth - 1).type.isInGroup('list'))) return false;
  const index = $pos.index();
  if (!isBox(index > 0 ? parent.child(index - 1) : null) && !isBox($pos.nodeAfter)) return false;
  const paragraph = parent.type.schema.nodes.paragraph;
  return paragraph !== undefined && parent.canReplaceWith(index, index, paragraph);
}

/**
 * A block a gap goes beside: one without text of its own (a container, an atom), or code (spec `code`); not a list
 * (schema group `list`), which is text to the arrows.
 */
function isBox(node: Node | null): boolean {
  if (node === null || !node.isBlock || node.type.isInGroup('list')) return false;
  return !node.isTextblock || node.type.spec.code === true;
}

type Direction = 'up' | 'down' | 'left' | 'right';

/** An arrow key towards `dir`: from a gap one stop on; from the edge of a text block onto the gap there, if any. */
function move(editor: Editor, dir: Direction): boolean {
  const { selection } = editor.state;
  const side = dir === 'up' || dir === 'left' ? -1 : 1;
  if (selection instanceof BlockGap) return moveFromGap(editor, selection.$head, side);
  if (!(selection instanceof TextSelection) || !selection.empty || !editor.view.endOfTextblock(dir)) return false;
  const $gap = gapLeaving(selection.$head, side);
  return $gap !== null && select(editor.view, new BlockGap($gap));
}

/** From the gap `$gap` towards `side`: onto the next gap before any text, else into what follows (a raw box's code). */
function moveFromGap(editor: Editor, $gap: ResolvedPos, side: -1 | 1): boolean {
  const $next = nextGap($gap, side);
  if ($next) return select(editor.view, new BlockGap($next));
  const next = Selection.findFrom($gap, side);
  if (next instanceof NodeSelection && editor.commands.editRawBox(next.from, side > 0 ? 0 : String(next.node.attrs.src ?? '').length)) return true;
  return next === null || select(editor.view, next);
}

function select(view: EditorView, selection: Selection): true {
  view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
  return true;
}

/**
 * Leaving the text block of `$head` towards `side`: the gap right beside it, else beside the innermost box it is the
 * last (first) block of, as long as nothing comes in between. Null: the next text comes first.
 */
function gapLeaving($head: ResolvedPos, side: -1 | 1): ResolvedPos | null {
  for (let depth = $head.depth; depth > 0; depth--) {
    const $edge = $head.doc.resolve(side > 0 ? $head.after(depth) : $head.before(depth));
    if (isGap($edge)) return $edge;
    const parent = $head.node(depth - 1);
    if (side > 0 ? $head.indexAfter(depth - 1) < parent.childCount : $head.index(depth - 1) > 0) return null;
  }
  return null;
}

/**
 * The next gap from the gap `$pos` towards `side`, out of the blocks it ends and into those that follow, before any
 * text or atom (ProseMirror's `GapCursor.findGapCursorFrom`, with our gaps).
 */
function nextGap($pos: ResolvedPos, side: -1 | 1): ResolvedPos | null {
  for (let $at = $pos, pos = stepFrom($at, side); pos !== null; pos = stepFrom($at, side)) {
    $at = $pos.doc.resolve(pos);
    if (isGap($at)) return $at;
  }
  return null;
}

/**
 * One position on from the block boundary `$at` towards `side`: out of its parent at its edge, else into the
 * container next to it; null: text or an atom comes next, or the document ends.
 */
function stepFrom($at: ResolvedPos, side: -1 | 1): number | null {
  const next = side > 0 ? $at.nodeAfter : $at.nodeBefore;
  if (!next) return $at.depth > 0 ? $at.pos + side : null;
  return next.isTextblock || next.isLeaf ? null : $at.pos + side;
}

/** Typing (`text`) or Enter (`''`) at a gap: a new paragraph there, the caret at its end. */
function insertParagraph(view: EditorView, text: string): boolean {
  const { state } = view;
  if (!(state.selection instanceof BlockGap)) return false;
  const { schema } = state;
  const pos = state.selection.head;
  const tr = state.tr.insert(pos, schema.nodes.paragraph.create(null, text === '' ? null : schema.text(text)));
  view.dispatch(tr.setSelection(TextSelection.create(tr.doc, pos + 1 + text.length)).scrollIntoView());
  return true;
}

/**
 * Backspace (`side` -1) or Delete (1) at a gap: selects the box on that side, so the next one deletes it; beside
 * text, the caret goes to that text's edge.
 */
function selectBeside(view: EditorView, side: -1 | 1): boolean {
  const { state } = view;
  const { selection } = state;
  if (!(selection instanceof BlockGap)) return false;
  const $gap = selection.$head;
  const node = side < 0 ? $gap.nodeBefore : $gap.nodeAfter;
  if (!node) return true;
  if (!node.isTextblock && NodeSelection.isSelectable(node)) return select(view, NodeSelection.create(state.doc, side < 0 ? $gap.pos - node.nodeSize : $gap.pos));
  return select(view, Selection.near($gap, side));
}

/**
 * A click into the space beside blocks (their margins, below the last one) of the container clicked: the gap at the
 * boundary above the next block below the click, if that is a gap and the click was beside every block.
 */
function clickGap(view: EditorView, event: MouseEvent): boolean {
  const start = view.editable ? containerStart(view, event.target) : null;
  const at = start === null ? null : boundaryAbove(view, start, event.clientY);
  const $at = at === null ? null : view.state.doc.resolve(at);
  if (!$at || !isGap($at)) return false;
  view.dispatch(view.state.tr.setSelection(new BlockGap($at)));
  return true;
}

/** Where the content of the container whose DOM is `target` starts; null: `target` is no container's (text, a box). */
function containerStart(view: EditorView, target: EventTarget | null): number | null {
  if (!(target instanceof Element) || !view.dom.contains(target)) return null;
  try {
    const $start = view.state.doc.resolve(view.posAtDOM(target, 0));
    return $start.parent.inlineContent || $start.pos !== $start.start() ? null : $start.pos;
  } catch {
    return null;
  }
}

/** The boundary before the first block of the container starting at `start` that ends below `y`; null: `y` is on a block. */
function boundaryAbove(view: EditorView, start: number, y: number): number | null {
  const container = view.state.doc.resolve(start).parent;
  let at = start;
  for (let index = 0; index < container.childCount; index++) {
    const rect = (view.nodeDOM(at) as Element | null)?.getBoundingClientRect();
    if (rect && y < rect.bottom) return y < rect.top ? at : null;
    at += container.child(index).nodeSize;
  }
  return at;
}

/**
 * A composition (an input method) starting at a gap: an empty paragraph to compose in, so the browser does not
 * abort it when the DOM selection moves (ProseMirror's gap cursor does the same).
 */
function startComposition(view: EditorView, event: InputEvent): boolean {
  if (event.inputType === 'insertCompositionText') insertParagraph(view, '');
  return false;
}

/** The gap's line, where the selection is a gap. */
function drawGap(state: EditorState): DecorationSet | null {
  if (!(state.selection instanceof BlockGap)) return null;
  const line = (view: EditorView) => {
    const dom = view.dom.ownerDocument.createElement('div');
    dom.className = 'zwf-visual__block-gap';
    return dom;
  };
  return DecorationSet.create(state.doc, [Decoration.widget(state.selection.head, line, { key: 'block-gap' })]);
}
