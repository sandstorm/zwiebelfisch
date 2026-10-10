// Raw boxes: Typst the Visual view does not model, edited as code in a nested CodeMirror; contributions add
// pictures (box renderers), headings, tools and code extensions. See nodes.ts.
import { defaultKeymap } from '@codemirror/commands';
import type { Extension as CodeExtension, Transaction as CodeTransaction } from '@codemirror/state';
import { EditorView as CodeView, keymap, type KeyBinding } from '@codemirror/view';
import { Extension, type Editor } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { NodeSelection, Selection } from '@tiptap/pm/state';
import type { Decoration, EditorView, NodeView } from '@tiptap/pm/view';
import { minimalChange } from '../../../core/typst-document/typst-document';
import { setBoxDecorations, type BoxAction, type BoxRenderer, type BoxTools, type BoxToolsHost, type CodeBoxSpec } from '../contributions/boxes';
import type { VisualViewContext } from '../contributions/view-context';
import { nodeGrammar, posToSource } from '../projection/projection';
import { BoxActionBar } from './box-actions';
import { RenderedBox } from './rendered-box';

type Side = -1 | 1;

/** The open raw boxes by their DOM, so arrow keys in the outer editor can move into them. */
const boxes = new WeakMap<globalThis.Node, RawBox>();

/** What the raw boxes of one view get from the contributions (see `setBoxes`). */
export interface Boxes {
  readonly view: VisualViewContext;
  /** Draw boxes instead of their code; the first that `renders` a box draws it. */
  readonly renderers: readonly BoxRenderer[];
  /** Extensions of every box's code editor. */
  readonly codeExtensions: readonly CodeExtension[];
  /** Buttons on the boxes they apply to. */
  readonly actions: readonly BoxAction[];
  /** What a box of a node type shows besides its code, by type name. */
  readonly specs: ReadonlyMap<string, CodeBoxSpec>;
}

/** What the boxes of an editor get (see `setBoxes`). */
const boxesOf = new WeakMap<Editor, Boxes>();

/** Gives the raw boxes of `editor` what contributions add to them. Set it before the boxes are created. */
export function setBoxes(editor: Editor, contributed: Boxes): void {
  boxesOf.set(editor, contributed);
}

/** What contributions add to a box of `node` in `editor`: its spec's heading and tools, code extensions, the renderer drawing it. */
function contributionsFor(
  editor: Editor,
  node: Node,
): Partial<Pick<Boxes, 'view'>> & { spec?: CodeBoxSpec; codeExtensions: readonly CodeExtension[]; renderer?: BoxRenderer; actions: readonly BoxAction[] } {
  const contributed = boxesOf.get(editor);
  if (!contributed) return { codeExtensions: [], actions: [] };
  const renderer = contributed.renderers.find((candidate) => candidate.renders(node));
  const { codeExtensions, actions, view } = contributed;
  return { spec: contributed.specs.get(node.type.name), codeExtensions, renderer, view, actions };
}

/** Whether `node` shows as a raw box (its spec asks for a code box). */
function isCodeBox(node: Node): boolean {
  return nodeGrammar(node)?.box === 'code';
}

const sharedTheme = {
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: 'inherit' },
  '.cm-content': { padding: '0' },
  '.cm-line': { padding: '0' },
  '&.cm-focused': { outline: 'none' },
};
const blockTheme = CodeView.theme(sharedTheme);
/**
 * Inline boxes must stay inline-level: CodeMirror's base theme makes the editor `display: flex !important`,
 * and a block inside the box's <span> splits it into three lines (before, the editor, after).
 */
const inlineTheme = CodeView.theme({
  ...sharedTheme,
  '&': { display: 'inline-flex !important', verticalAlign: 'baseline' },
  '.cm-scroller': { ...sharedTheme['.cm-scroller'], overflow: 'visible' },
});

/**
 * A raw box (a node whose spec has `box: 'code'`: `rawBlock`, `rawInline`, an image call, an outline):
 * Typst the Visual view does not model, edited in place in a nested CodeMirror (the language and its colors
 * are contributed: `registerBoxCodeExtension`).
 *
 * The box's text is the node's `src` attribute, which the projection prints
 * verbatim: every edit sets `src` (an attribute step, so positions and the
 * outer selection stay put), and outside changes to `src` flow back into the
 * box as one minimal change. Undo/redo go to the Visual view's history;
 * arrow keys at the edges, Escape (and Enter in inline boxes) leave the box;
 * Backspace in an empty box deletes it. With a box renderer that draws it,
 * the box shows its picture instead of the code until the code gets focus.
 * Its spec's `codeBox` may head it (an outline: "Table of contents") and add
 * tools (an image: resize handles, a toolbar); clicking the picture of a box
 * with tools selects the box rather than opening the code (double-click,
 * Enter or the tools' "Edit code" do).
 */
class RawBox implements NodeView {
  readonly dom: HTMLElement;
  private readonly spec: CodeBoxSpec | undefined;
  /** Above the code: what the box shows. */
  private readonly label: HTMLElement | null;
  private readonly code: CodeView;
  private readonly rendered: RenderedBox | null;
  private readonly tools: BoxTools | null;
  /** The contributed action buttons that apply to the box (with its tools, else above the code). */
  private readonly actionBar: BoxActionBar | null;
  /** Set while mirroring `src` into the box, so that change is not sent back. */
  private mirroring = false;

  constructor(private node: Node, private readonly editor: Editor, private readonly getPos: () => number | undefined, decorations: readonly Decoration[]) {
    const inline = node.isInline;
    const { spec, codeExtensions, renderer, view, actions } = contributionsFor(editor, node);
    this.spec = spec;
    this.dom = editor.view.dom.ownerDocument.createElement(inline ? 'span' : 'div');
    this.dom.className = inline ? 'typst-visual__raw-inline' : 'typst-visual__raw-block';
    this.label = this.createLabel(node);
    const wrapper = this.dom.appendChild(this.dom.ownerDocument.createElement(inline ? 'span' : 'div'));
    wrapper.className = 'typst-visual__code';
    this.code = this.createCode(wrapper, inline, codeExtensions);
    boxes.set(this.dom, this);
    this.showDecorations(decorations);
    this.rendered = renderer ? this.createRendered(wrapper, renderer) : null;
    this.actionBar = view && actions.length > 0 ? new BoxActionBar(this.dom.ownerDocument, actions, view, node) : null;
    this.tools = view && spec?.tools ? spec.tools(this.toolsHost(wrapper, view), node) : null;
    this.placeActionBar(wrapper);
  }

  /** The action buttons above the code, unless the tools put them in place. */
  private placeActionBar(code: HTMLElement): void {
    const bar = this.actionBar?.element;
    if (bar && !bar.parentElement) this.dom.insertBefore(bar, code);
  }

  /** Focuses the box with the cursor at its start (entered moving forward) or its end. */
  focus(side: Side): void {
    this.rendered?.edit();
    this.code.focus();
    this.code.dispatch({ selection: { anchor: side > 0 ? 0 : this.code.state.doc.length } });
  }

  update(node: Node, decorations: readonly Decoration[]): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    const change = minimalChange(this.code.state.doc.toString(), node.attrs.src);
    if (change) {
      this.mirroring = true;
      this.code.dispatch({ changes: change });
      this.mirroring = false;
    }
    this.updateLabel();
    this.showDecorations(decorations);
    this.tools?.update(node);
    this.actionBar?.update(node);
    this.rendered?.update();
    return true;
  }

  selectNode(): void {
    this.dom.classList.add('ProseMirror-selectednode');
    this.tools?.select();
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
    this.tools?.destroy();
    this.rendered?.destroy();
    this.code.destroy();
  }

  /** The nested code editor, in `parent`. */
  private createCode(parent: HTMLElement, inline: boolean, contributed: readonly CodeExtension[]): CodeView {
    return new CodeView({
      parent,
      // The box is not attached yet, so CodeMirror cannot find its root itself; in a shadow root
      // (<typst-editor>) it would read focus and selection from the document and style the wrong tree.
      root: this.editor.view.root,
      doc: this.node.attrs.src,
      extensions: [
        keymap.of([...this.keys(inline), ...defaultKeymap]),
        inline ? inlineTheme : [blockTheme, CodeView.lineWrapping],
        CodeView.contentAttributes.of({ 'aria-label': 'Typst code' }),
        contributed,
      ],
      dispatchTransactions: (trs, view) => this.forward(trs, view),
    });
  }

  /** The picture `renderer` draws in place of the code; clicking it selects a box with tools, else edits the code. */
  private createRendered(code: HTMLElement, renderer: BoxRenderer): RenderedBox {
    const activate = () => (this.spec?.tools ? this.select() : this.focus(-1));
    return new RenderedBox({ dom: this.dom, code, source: () => this.source(), activate }, renderer);
  }

  /** What the box's tools get: the box, its picture (if rendered), the editor and view, how to edit the code. */
  private toolsHost(code: HTMLElement, view: VisualViewContext): BoxToolsHost {
    const picture = this.rendered?.picture ?? null;
    const actions = this.actionBar?.element ?? this.dom.ownerDocument.createElement('span');
    return { dom: this.dom, code, picture, editor: this.editor, view, getPos: this.getPos, editCode: () => this.focus(-1), actions };
  }

  /** Hands the box's decorations (e.g. other users' carets in it) to its code's extensions (`setBoxDecorations`). */
  private showDecorations(decorations: readonly Decoration[]): void {
    this.code.dispatch({ effects: setBoxDecorations.of(decorations) });
  }

  /** The node and where its source starts, while the box is in the document. */
  private source(): { node: Node; from: number } | null {
    const pos = this.getPos();
    return pos === undefined ? null : { node: this.node, from: posToSource(this.editor.state.doc, pos) };
  }

  private createLabel(node: Node): HTMLElement | null {
    const label = this.spec?.label;
    if (!label) return null;
    this.dom.classList.add(label.className);
    const element = this.dom.appendChild(this.dom.ownerDocument.createElement('div'));
    element.className = `typst-visual__box-label ${label.className}-label`;
    element.textContent = label.text(node.attrs.src);
    return element;
  }

  private updateLabel(): void {
    if (this.label) this.label.textContent = this.spec!.label!.text(this.node.attrs.src);
  }

  /** Selects the box as a whole in the outer editor (a box with tools: shows them). */
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

/** The node view of a raw box in `editor`. */
export function rawBoxView(node: Node, editor: Editor, getPos: () => number | undefined, decorations: readonly Decoration[]): NodeView {
  return new RawBox(node, editor, getPos, decorations);
}

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
  return next instanceof NodeSelection && isCodeBox(next.node) && focusBox(view, next.from, side);
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
        return selection instanceof NodeSelection && isCodeBox(selection.node) && focusBox(this.editor.view, selection.from, 1);
      },
    };
  },
});
