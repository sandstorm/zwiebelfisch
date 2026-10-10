import { defaultKeymap } from '@codemirror/commands';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import type { Transaction as CodeTransaction } from '@codemirror/state';
import { EditorView as CodeView, keymap, type KeyBinding } from '@codemirror/view';
import { Extension, type Editor, type NodeViewRenderer } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { NodeSelection, Selection } from '@tiptap/pm/state';
import type { EditorView, NodeView } from '@tiptap/pm/view';
import { minimalChange } from '../document/minimal-change';
import { typstLanguage } from '../source-view/typst-language';
import { ImageTools } from './image-tools';
import { posToSource } from './projection';
import { RenderedBox, type BoxRenderer } from './rendered-box';

type Side = -1 | 1;

/** The open raw boxes by their DOM, so arrow keys in the outer editor can move into them. */
const boxes = new WeakMap<globalThis.Node, RawBox>();

const RAW_TYPES = new Set(['rawBlock', 'rawInline', 'image']);

/** What the raw boxes of an editor show while not edited (see `setBoxRenderer`). */
const renderers = new WeakMap<Editor, BoxRenderer>();

/**
 * Lets the raw boxes of `editor` show compiled snippets and images instead
 * of their code while they are not being edited. Set it before the boxes are
 * created.
 */
export function setBoxRenderer(editor: Editor, renderer: BoxRenderer): void {
  renderers.set(editor, renderer);
}

const sharedTheme = {
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: 'inherit' },
  '.cm-content': { padding: '0' },
  '.cm-line': { padding: '0' },
  '&.cm-focused': { outline: 'none' },
};
const blockTheme = CodeView.theme(sharedTheme);
const inlineTheme = CodeView.theme({
  ...sharedTheme,
  '&': { display: 'inline-flex', verticalAlign: 'baseline' },
  '.cm-scroller': { ...sharedTheme['.cm-scroller'], overflow: 'visible' },
});

/**
 * A raw box (`rawBlock` / `rawInline` / `image`): Typst the Visual view does not model,
 * edited in place in a nested CodeMirror with Typst highlighting.
 *
 * The box's text is the node's `src` attribute, which the projection prints
 * verbatim: every edit sets `src` (an attribute step, so positions and the
 * outer selection stay put), and outside changes to `src` flow back into the
 * box as one minimal change. Undo/redo go to the Visual view's history;
 * arrow keys at the edges, Escape (and Enter in inline boxes) leave the box;
 * Backspace in an empty box deletes it. With a renderer (`setBoxRenderer`),
 * the box shows the image or its compiled snippet instead of the code until
 * the code gets focus. An `image` box adds its `ImageTools` (path heading,
 * resize handles, caption/width/alt toolbar); clicking its picture selects
 * the image rather than opening the code (double-click, Enter or "Edit code" do).
 */
class RawBox implements NodeView {
  readonly dom: HTMLElement;
  private readonly code: CodeView;
  private readonly rendered: RenderedBox | null = null;
  private readonly image: ImageTools | null = null;
  /** Set while mirroring `src` into the box, so that change is not sent back. */
  private mirroring = false;

  constructor(private node: Node, private readonly editor: Editor, private readonly getPos: () => number | undefined) {
    const inline = node.isInline;
    this.dom = editor.view.dom.ownerDocument.createElement(inline ? 'span' : 'div');
    this.dom.className = inline ? 'typst-visual__raw-inline' : 'typst-visual__raw-block';
    const isImage = node.type.name === 'image';
    if (isImage) this.dom.classList.add('typst-visual__image');
    const wrapper = this.dom.appendChild(this.dom.ownerDocument.createElement(inline ? 'span' : 'div'));
    wrapper.className = 'typst-visual__code';
    this.code = new CodeView({
      parent: wrapper,
      doc: node.attrs.src,
      extensions: [
        keymap.of([...this.keys(inline), ...defaultKeymap]),
        typstLanguage(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        inline ? inlineTheme : [blockTheme, CodeView.lineWrapping],
        CodeView.contentAttributes.of({ 'aria-label': 'Typst code' }),
      ],
      dispatchTransactions: (trs, view) => this.forward(trs, view),
    });
    boxes.set(this.dom, this);
    const renderer = renderers.get(editor);
    if (renderer) {
      const host = { dom: this.dom, code: wrapper, source: () => this.source(), activate: () => (isImage ? this.select() : this.focus(-1)) };
      this.rendered = new RenderedBox(host, renderer);
    }
    if (isImage) {
      const host = { dom: this.dom, code: wrapper, picture: this.rendered?.picture ?? null, editor, getPos, editCode: () => this.focus(-1) };
      this.image = new ImageTools(host, node);
    }
  }

  /** Focuses the box with the cursor at its start (entered moving forward) or its end. */
  focus(side: Side): void {
    this.rendered?.edit();
    this.code.focus();
    this.code.dispatch({ selection: { anchor: side > 0 ? 0 : this.code.state.doc.length } });
  }

  update(node: Node): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    const change = minimalChange(this.code.state.doc.toString(), node.attrs.src);
    if (change) {
      this.mirroring = true;
      this.code.dispatch({ changes: change });
      this.mirroring = false;
    }
    this.image?.update(node);
    this.rendered?.update(node);
    return true;
  }

  selectNode(): void {
    this.dom.classList.add('ProseMirror-selectednode');
    this.image?.refresh();
  }

  deselectNode(): void {
    this.dom.classList.remove('ProseMirror-selectednode');
  }

  stopEvent(): boolean {
    return true;
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy(): void {
    this.image?.destroy();
    this.rendered?.destroy();
    this.code.destroy();
  }

  /** The node and where its source starts, while the box is in the document. */
  private source(): { node: Node; from: number } | null {
    const pos = this.getPos();
    return pos === undefined ? null : { node: this.node, from: posToSource(this.editor.state.doc, pos) };
  }

  /** Selects the box as a whole in the outer editor (an image: shows its tools). */
  private select(): void {
    const pos = this.getPos();
    if (pos === undefined) return;
    const outer = this.editor.view;
    outer.dispatch(outer.state.tr.setSelection(NodeSelection.create(outer.state.doc, pos)));
    outer.focus();
  }

  private forward(trs: readonly CodeTransaction[], view: CodeView): void {
    view.update(trs);
    const pos = this.getPos();
    if (this.mirroring || pos === undefined || !trs.some((tr) => tr.docChanged)) return;
    const outer = this.editor.view;
    outer.dispatch(outer.state.tr.setNodeAttribute(pos, 'src', view.state.doc.toString()));
  }

  private keys(inline: boolean): KeyBinding[] {
    const head = () => this.code.state.selection.main;
    const doc = () => this.code.state.doc;
    const atStart = () => head().empty && head().head === 0;
    const atEnd = () => head().empty && head().head === doc().length;
    return [
      { key: 'Mod-z', run: () => (this.editor.commands.undo(), true) },
      { key: 'Mod-y', run: () => (this.editor.commands.redo(), true) },
      { key: 'Mod-Shift-z', run: () => (this.editor.commands.redo(), true) },
      { key: 'ArrowLeft', run: () => atStart() && this.leave(-1) },
      { key: 'ArrowRight', run: () => atEnd() && this.leave(1) },
      { key: 'ArrowUp', run: () => head().empty && doc().lineAt(head().head).number === 1 && this.leave(-1) },
      { key: 'ArrowDown', run: () => head().empty && doc().lineAt(head().head).number === doc().lines && this.leave(1) },
      { key: 'Escape', run: () => this.leave(1) },
      { key: 'Enter', run: () => inline && this.leave(1) },
      { key: 'Backspace', run: () => doc().length === 0 && this.remove() },
    ];
  }

  /** Moves the cursor into the outer editor, just before or after this box. */
  private leave(side: Side): boolean {
    const pos = this.getPos();
    if (pos === undefined) return false;
    const outer = this.editor.view;
    const $edge = outer.state.doc.resolve(side < 0 ? pos : pos + this.node.nodeSize);
    outer.dispatch(outer.state.tr.setSelection(Selection.near($edge, side)).scrollIntoView());
    outer.focus();
    return true;
  }

  private remove(): boolean {
    const pos = this.getPos();
    if (pos === undefined) return false;
    const outer = this.editor.view;
    const tr = outer.state.tr.delete(pos, pos + this.node.nodeSize);
    outer.dispatch(tr.setSelection(Selection.near(tr.doc.resolve(Math.min(pos, tr.doc.content.size)))).scrollIntoView());
    outer.focus();
    return true;
  }
}

export const rawBoxView: NodeViewRenderer = ({ node, editor, getPos }) => new RawBox(node, editor, getPos);

/** The raw box at `pos` in the outer editor, if one is shown there. */
function boxAt(view: EditorView, pos: number): RawBox | undefined {
  const dom = view.nodeDOM(pos);
  return dom ? boxes.get(dom) : undefined;
}

type Direction = 'up' | 'down' | 'left' | 'right';

/** Arrow key handling in the outer editor: moving onto a raw box puts the cursor inside it. */
function enterBox(editor: Editor, dir: Direction): boolean {
  if (!editor.state.selection.empty) return false;
  const side: Side = dir === 'left' || dir === 'up' ? -1 : 1;
  const horizontal = dir === 'left' || dir === 'right';
  return (horizontal && enterInlineBox(editor, side)) || enterBlockBox(editor, dir, side);
}

/** Left/right next to a raw inline box. */
function enterInlineBox({ state, view }: Editor, side: Side): boolean {
  const { $head } = state.selection;
  const neighbour = side > 0 ? $head.nodeAfter : $head.nodeBefore;
  if (neighbour?.type.name !== 'rawInline') return false;
  return focusBox(view, side > 0 ? $head.pos : $head.pos - neighbour.nodeSize, side);
}

/** Leaving a textblock towards a raw block (the PM "embedded code editor" arrow handler). */
function enterBlockBox({ state, view }: Editor, dir: Direction, side: Side): boolean {
  const { $head } = state.selection;
  if ($head.depth === 0 || !view.endOfTextblock(dir)) return false;
  const next = Selection.near(state.doc.resolve(side > 0 ? $head.after() : $head.before()), side);
  return next instanceof NodeSelection && RAW_TYPES.has(next.node.type.name) && focusBox(view, next.from, side);
}

function focusBox(view: EditorView, pos: number, side: Side): boolean {
  const box = boxAt(view, pos);
  box?.focus(side);
  return box !== undefined;
}

/** Keyboard entry into raw boxes: arrow keys at their edges, Enter on a selected box. */
export const RawBoxNavigation = Extension.create({
  name: 'typstRawBoxNavigation',
  addKeyboardShortcuts() {
    return {
      ArrowLeft: () => enterBox(this.editor, 'left'),
      ArrowRight: () => enterBox(this.editor, 'right'),
      ArrowUp: () => enterBox(this.editor, 'up'),
      ArrowDown: () => enterBox(this.editor, 'down'),
      Enter: () => {
        const { selection } = this.editor.state;
        return selection instanceof NodeSelection && RAW_TYPES.has(selection.node.type.name)
          && focusBox(this.editor.view, selection.from, 1);
      },
    };
  },
});
