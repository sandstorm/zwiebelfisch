// Text alignment: `#align(..)` blocks and alignment set rules, edited through the toolbar. See visual-view.ts.
import { Node } from '@tiptap/core';
import type { Node as PMNode, NodeRange, ResolvedPos } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { liftTarget } from '@tiptap/pm/transform';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { alignArgs, setRules, withHorizontal, type Horizontal, type TextAlignment } from '../model/model';


declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    alignment: {
      /** Aligns the selected blocks (left, center, right) or justifies the selected paragraphs. */
      setTextAlign: (alignment: TextAlignment) => ReturnType;
      /** Lets the selected blocks follow the document's alignment again. */
      unsetTextAlign: () => ReturnType;
    };
  }
}

/**
 * Text alignment in the Visual view, as Typst writes it:
 *
 * - an `alignment` block is `#align(args)[blocks]`: it holds editable blocks
 *   (paragraphs, headings, lists, …); `args` is the literal alignment as
 *   written (`center`, `top + center`). Only its horizontal part is edited.
 * - a paragraph's `justify` (`true` / `false`, `null` when unset) is
 *   `#par(justify: ..)[text]` around that one paragraph.
 * - `#set align(..)` and `#set par(justify: ..)` in raw blocks set the
 *   default for the blocks after them (in the same container).
 *
 * The view shows every textblock's effective alignment (CSS `text-align`), and
 * `textAlignAt` tells the toolbar which one the selection has. The commands
 * change the source as little as possible, in one transaction: an alignment
 * equal to the surrounding one removes the wrapper instead of adding one; a
 * partly selected alignment block is split; justification is per paragraph.
 * Shortcuts: Mod-Shift-L / E / R / J.
 */
export const TextAlign = Node.create({
  name: 'alignment',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return {
      args: { default: 'center', rendered: false },
      sep: { default: null, rendered: false },
      layout: { default: null, rendered: false },
    };
  },
  addGlobalAttributes() {
    return [{ types: ['paragraph'], attributes: { justify: { default: null, rendered: false, parseHTML: () => null } } }];
  },
  parseHTML() {
    return [{ tag: 'div[data-typst-align]', getAttrs: (element) => ({ args: element.getAttribute('data-typst-align') }) }];
  },
  renderHTML({ node }) {
    const horizontal = alignArgs(node.attrs.args)?.horizontal;
    const style = horizontal ? `text-align: ${horizontal}` : undefined;
    return ['div', { class: 'typst-visual__align', 'data-typst-align': node.attrs.args, style }, 0];
  },
  addCommands() {
    return {
      setTextAlign: (alignment) => ({ tr }) => align(tr, alignment),
      unsetTextAlign: () => ({ tr }) => align(tr, null),
    };
  },
  addKeyboardShortcuts() {
    const set = (alignment: TextAlignment) => () => this.editor.commands.setTextAlign(alignment);
    return { 'Mod-Shift-l': set('left'), 'Mod-Shift-e': set('center'), 'Mod-Shift-r': set('right'), 'Mod-Shift-j': set('justify') };
  },
  addProseMirrorPlugins() {
    return [alignmentDecorations];
  },
});

/** The alignment the selection shows: that of the textblock it starts in, else of where it starts. */
export function textAlignAt(state: EditorState): TextAlignment {
  const { $from } = state.selection;
  if ($from.parent.isTextblock) return effective(scopeAt($from, $from.depth - 1), $from.parent);
  return scopeAt($from).horizontal;
}

// --------------------------------------------------------------------- scope

/** The alignment in force at some point: from set rules and enclosing alignment blocks. */
interface Scope {
  horizontal: Horizontal;
  justify: boolean;
}

const DEFAULT_SCOPE: Scope = { horizontal: 'left', justify: false };

/** The scope inside `node`, given the scope around it. */
function enter(scope: Scope, node: PMNode): Scope {
  const horizontal = node.type.name === 'alignment' ? alignArgs(node.attrs.args)?.horizontal : null;
  return horizontal ? { ...scope, horizontal } : scope;
}

const rulesOf = new WeakMap<PMNode, ReturnType<typeof setRules>>();

/** The scope after `sibling`: set rules in a raw block apply to the blocks that follow it. */
function after(scope: Scope, sibling: PMNode): Scope {
  if (sibling.type.name !== 'rawBlock') return scope;
  let rules = rulesOf.get(sibling);
  if (!rules) rulesOf.set(sibling, (rules = setRules(sibling.attrs.src)));
  return { ...scope, ...rules };
}

/** The scope of a block at `$pos` in its parent at `depth` (default: `$pos`'s own parent). */
function scopeAt($pos: ResolvedPos, depth = $pos.depth): Scope {
  let scope = DEFAULT_SCOPE;
  for (let d = 0; d <= depth; d++) {
    const node = $pos.node(d);
    scope = enter(scope, node);
    for (let i = 0; i < $pos.index(d); i++) scope = after(scope, node.child(i));
  }
  return scope;
}

/** How a textblock in `scope` is aligned. Justification applies to paragraphs only. */
function effective(scope: Scope, block: PMNode): TextAlignment {
  const justify = block.type.name === 'paragraph' && (block.attrs.justify ?? scope.justify);
  return justify ? 'justify' : scope.horizontal;
}

/** Shows each textblock's effective alignment, including what set rules and enclosing blocks give it. */
const alignmentDecorations = new Plugin<DecorationSet>({
  key: new PluginKey('typstTextAlign'),
  state: {
    init: (_config, state) => decorate(state.doc),
    apply: (tr, old) => (tr.docChanged ? decorate(tr.doc) : old),
  },
  props: {
    decorations(state) {
      return this.getState(state);
    },
  },
});

function decorate(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = [];
  const walk = (container: PMNode, start: number, scope: Scope) => {
    container.forEach((child, offset) => {
      const pos = start + offset;
      const alignment = child.isTextblock ? effective(scope, child) : null;
      if (alignment && alignment !== 'left') decorations.push(Decoration.node(pos, pos + child.nodeSize, { style: `text-align: ${alignment}` }));
      else if (!child.isTextblock && !child.isAtom) walk(child, pos + 1, enter(scope, child));
      scope = after(scope, child);
    });
  };
  walk(doc, 0, DEFAULT_SCOPE);
  return DecorationSet.create(doc, decorations);
}

// ------------------------------------------------------------------ commands

/** Nodes whose children can be wrapped in an alignment block. */
const CONTAINERS = new Set(['doc', 'alignment', 'tableCell', 'tableHeader']);

function selectedBlocks(tr: Transaction): NodeRange | null {
  const { $from, $to } = tr.selection;
  return $from.blockRange($to, (node) => CONTAINERS.has(node.type.name));
}

/** Aligns the selected blocks as `target` says; null: as their surroundings. */
function align(tr: Transaction, target: TextAlignment | null): boolean {
  if (!selectedBlocks(tr)) return false;
  alignBlocks(tr, target === 'justify' ? null : target);
  justifyParagraphs(tr, target);
  return true;
}

/** Puts the selected blocks in an alignment block for `horizontal`, or out of any (null, or the surrounding alignment). */
function alignBlocks(tr: Transaction, horizontal: Horizontal | null): void {
  let range = selectedBlocks(tr)!;
  if (range.parent.type.name === 'alignment') {
    if (range.startIndex === 0 && range.endIndex === range.parent.childCount) return realign(tr, range, horizontal);
    lift(tr, range);
    range = selectedBlocks(tr)!;
  }
  unwrapAlignments(tr, range);
  range = selectedBlocks(tr)!;
  const around = scopeAt(range.$from, range.depth).horizontal;
  const wanted = horizontal ?? around;
  if (wanted !== around) tr.wrap(range, [{ type: tr.doc.type.schema.nodes.alignment, attrs: { args: wanted } }]);
}

/** Changes the alignment block holding exactly `range`: its horizontal alignment, or removes it where it adds nothing. */
function realign(tr: Transaction, range: NodeRange, horizontal: Horizontal | null): void {
  const block = range.parent;
  const outside = scopeAt(range.$from, range.depth - 1).horizontal;
  const wanted = horizontal ?? outside;
  const parts = alignArgs(block.attrs.args);
  if (wanted === outside && !parts?.vertical) return lift(tr, range);
  if (parts?.horizontal !== wanted) {
    tr.setNodeMarkup(range.$from.before(range.depth), undefined, { ...block.attrs, args: withHorizontal(block.attrs.args, wanted) });
  }
}

/** Replaces the alignment blocks (without a vertical part) directly in `range` by their content. */
function unwrapAlignments(tr: Transaction, range: NodeRange): void {
  const blocks: number[] = [];
  for (let i = range.startIndex, pos = range.start; i < range.endIndex; pos += range.parent.child(i++).nodeSize) {
    const child = range.parent.child(i);
    if (child.type.name === 'alignment' && !alignArgs(child.attrs.args)?.vertical) blocks.push(pos);
  }
  for (const pos of blocks.reverse()) {
    const block = tr.doc.nodeAt(pos)!;
    lift(tr, tr.doc.resolve(pos + 1).blockRange(tr.doc.resolve(pos + block.nodeSize - 1))!);
  }
}

/** Lifts the blocks of `range` out of their parent; their separators belonged there, so they get the default ones. */
function lift(tr: Transaction, range: NodeRange): void {
  const target = liftTarget(range);
  if (target === null) return;
  for (let i = range.startIndex, pos = range.start; i < range.endIndex; pos += range.parent.child(i++).nodeSize) {
    const block = range.parent.child(i);
    if (block.attrs.sep) tr.setNodeMarkup(pos, undefined, { ...block.attrs, sep: null });
  }
  tr.lift(range, target);
}

/** Sets `justify` on the selected paragraphs (not in list items) where it differs from what their scope gives them. */
function justifyParagraphs(tr: Transaction, target: TextAlignment | null): void {
  const { from, to } = tr.selection;
  tr.doc.nodesBetween(from, to, (node, pos, parent) => {
    if (node.type.name !== 'paragraph') return true;
    if (parent?.type.name === 'listItem') return false;
    const scope = scopeAt(tr.doc.resolve(pos));
    const justify = target === null || (target === 'justify') === scope.justify ? null : target === 'justify';
    if (node.attrs.justify !== justify) tr.setNodeMarkup(pos, undefined, { ...node.attrs, justify });
    return false;
  });
}
