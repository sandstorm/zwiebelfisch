import { defaultKeymap, indentLess, indentMore } from '@codemirror/commands';
import type { Disposable } from '../../../core/disposable/disposable';
import type { Extension as CodeExtension, Transaction as CodeTransaction } from '@codemirror/state';
import { EditorView as CodeView, keymap, type KeyBinding } from '@codemirror/view';
import { Extension, type Editor } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { NodeSelection, Selection } from '@tiptap/pm/state';
import type { Decoration, EditorView, NodeView, NodeViewConstructor } from '@tiptap/pm/view';
import { minimalChange, type SourceOffset } from '../../../core/typst-document/typst-document';
import { setRawBoxDecorations, type RawBoxPictureHost, type RawBoxRenderer, type RawBoxTools, type RawBoxToolsHost, type TypstNodeSpec, type VisualEditorContext } from '../visual-editor';
import { posToSource } from '../../prosemirror-typst/prosemirror-typst';
import { blockGapAt } from '../block-gaps';
import { RenderedBox } from './rendered-box';

/**
 * The node views of raw boxes in `tiptap`, with what `boxes` contribute to them.
 *
 * A raw box holds Typst the Visual editor does not model, or a node whose spec asks for a code box (an image call, an
 * outline). It is edited as code in a nested CodeMirror, so no Typst is lost or rewritten. Contributions add the code's
 * language and links, a picture instead of the code (box renderers) and what the picture does, a title and tools.
 *
 * @internal Extensions add to them through `visualEditor.registerRawBoxRenderer`, `registerRawBoxCodeMirrorExtension`,
 * `registerRawBoxPictureExtension` and a node spec's `tools`.
 */
export function rawBoxViews(tiptap: Editor, boxes: RawBoxes): NodeViewConstructor {
  return (node, _view, getPos, decorations) => new RawBox(node, getPos, decorations, { tiptap, boxes });
}

/** What the raw boxes of one editor get from the contributions. */
export interface RawBoxes {
  readonly editor: VisualEditorContext;
  /** Draw boxes instead of their code; the first that `renders` a box draws it. */
  readonly renderers: readonly RawBoxRenderer[];
  /** Extensions of every box's code editor. */
  readonly codeExtensions: readonly CodeExtension[];
  /** Take part in every box's picture (see `registerRawBoxPictureExtension`). */
  readonly pictureExtensions: readonly ((box: RawBoxPictureHost) => Disposable)[];
  /** What the specs ask the editor for, by node type name (a box's title and tools). */
  readonly nodeViews: ReadonlyMap<string, NonNullable<TypstNodeSpec['view']>>;
}

/**
 * Keyboard entry into raw boxes: arrow keys at their edges, Enter on a selected box. The
 * command `editRawBox` enters a box from code (a box just inserted, the caret inside its code; a range revealed in it).
 */
export const RawBoxNavigation = Extension.create({
  name: 'typstRawBoxNavigation',
  addCommands() {
    return {
      editRawBox:
        (pos, from, to = from) =>
        ({ view, dispatch }) => {
          const box = boxAt(view, pos);
          if (box && dispatch) box.edit(from, to);
          return box !== undefined;
        },
    };
  },
  addKeyboardShortcuts() {
    return {
      ArrowLeft: () => enterBox(this.editor, 'left'),
      ArrowRight: () => enterBox(this.editor, 'right'),
      ArrowUp: () => enterBox(this.editor, 'up'),
      ArrowDown: () => enterBox(this.editor, 'down'),
      Enter: () => {
        const { selection } = this.editor.state;
        return selection instanceof NodeSelection && focusBox(this.editor.view, selection.from, 1);
      },
    };
  },
});

/**
 * One raw box (a node whose spec has `view.box: 'code'`: `rawBlock`, `rawInline`, an image call, an outline).
 *
 * The box's text is the node's `src` attribute, which the serializer prints
 * verbatim: every edit sets `src` (an attribute step, so positions and the
 * outer selection stay put), and outside changes to `src` flow back into the
 * box as one minimal change. Undo/redo go to the Visual editor's history;
 * arrow keys at the edges, Escape (and Enter in inline boxes) leave the box;
 * Backspace in an empty box deletes it; Tab indents a block box's code. With a box renderer that draws it,
 * the box shows its picture instead of the code until the code gets focus.
 * Its spec's `view.title` may head it (an outline: "Table of contents"), `view.tools` add
 * tools (an image: heading, resize handles); clicking the picture of a box
 * with tools selects the box rather than opening the code (double-click,
 * or Enter do).
 * What the outer editor drags (a block by its handle, text) lands beside a box it is dropped on, not in its code.
 */
class RawBox implements NodeView {
  readonly dom: HTMLElement;
  private readonly spec: TypstNodeSpec['view'];
  /** Above the code: what the box shows. */
  private readonly label: HTMLElement | null;
  private readonly code: CodeView;
  private readonly rendered: RenderedBox | null;
  private readonly tools: RawBoxTools | null;
  private readonly pictureExtensions: RawBoxes['pictureExtensions'];
  private readonly editor: VisualEditorContext;
  /** Set while mirroring `src` into the box, so that change is not sent back. */
  private mirroring = false;
  private readonly tiptap: Editor;

  constructor(
    private node: Node,
    private readonly getPos: () => number | undefined,
    decorations: readonly Decoration[],
    { tiptap, boxes: { editor, renderers, codeExtensions, pictureExtensions, nodeViews } }: { tiptap: Editor; boxes: RawBoxes },
  ) {
    this.tiptap = tiptap;
    this.pictureExtensions = pictureExtensions;
    this.editor = editor;
    const inline = node.isInline;
    const spec = nodeViews.get(node.type.name);
    const renderer = renderers.find((candidate) => candidate.renders(node));
    this.spec = spec;
    this.dom = tiptap.view.dom.ownerDocument.createElement(inline ? 'span' : 'div');
    this.dom.className = inline ? 'zwf-visual__raw-inline' : 'zwf-visual__raw-block';
    this.label = this.createLabel(node);
    const wrapper = this.dom.appendChild(this.dom.ownerDocument.createElement(inline ? 'span' : 'div'));
    wrapper.className = 'zwf-visual__code';
    this.code = this.createCode(wrapper, inline, codeExtensions);
    boxes.set(this.dom, this);
    this.showDecorations(decorations);
    this.rendered = renderer ? this.createRendered(wrapper, renderer) : null;
    this.tools = spec?.tools ? spec.tools(this.toolsHost(wrapper, editor), node) : null;
  }

  /** Focuses the box with the cursor at its start (entered moving forward) or its end. */
  focus(side: Side): void {
    this.edit(side > 0 ? 0 : this.code.state.doc.length);
  }

  /** Shows and focuses the code, `from..to` in it selected (a cursor if equal; kept within the code), scrolled to. */
  edit(from: number, to = from): void {
    const clamp = (offset: number) => Math.min(Math.max(offset, 0), this.code.state.doc.length);
    this.rendered?.edit();
    this.code.focus();
    this.code.dispatch({ selection: { anchor: clamp(from), head: clamp(to) }, scrollIntoView: true });
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
    this.rendered?.update();
    return true;
  }

  selectNode(): void {
    this.dom.classList.add('ProseMirror-selectednode');
  }

  deselectNode(): void {
    this.dom.classList.remove('ProseMirror-selectednode');
  }

  /** Events in the box are its own, except the drags and drops of the outer editor. */
  stopEvent(event: Event): boolean {
    if (event.type.startsWith('drag') || event.type === 'drop') return this.tiptap.view.dragging === null;
    return true;
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy(): void {
    this.tools?.dispose();
    this.rendered?.dispose();
    this.code.destroy();
  }

  /** The nested code editor, in `parent`. */
  private createCode(parent: HTMLElement, inline: boolean, contributed: readonly CodeExtension[]): CodeView {
    return new CodeView({
      parent,
      // The box is not attached yet, so CodeMirror cannot find its root itself; in a shadow root
      // (<zwiebelfisch-editor>) it would read focus and selection from the document and style the wrong tree.
      root: this.tiptap.view.root,
      doc: this.node.attrs.src,
      extensions: [
        keymap.of([...this.keys(inline), ...defaultKeymap]),
        inline ? inlineTheme : [blockTheme, CodeView.lineWrapping],
        CodeView.contentAttributes.of({ 'aria-label': 'Typst code' }),
        CodeView.domEventHandlers({ drop: (event) => this.dropBeside(event) }),
        contributed,
      ],
      dispatchTransactions: (trs, view) => this.forward(trs, view),
    });
  }

  /**
   * A drop on the code of what the outer editor drags (a block, text) is the outer editor's: sent again from the box
   * (see `stopEvent`), it lands beside the box rather than in the code as text.
   */
  private dropBeside(event: DragEvent): boolean {
    if (this.tiptap.view.dragging === null) return false;
    const { clientX, clientY, altKey, ctrlKey, metaKey, shiftKey, dataTransfer } = event;
    const init = { bubbles: true, cancelable: true, clientX, clientY, altKey, ctrlKey, metaKey, shiftKey };
    this.dom.dispatchEvent(Object.assign(new MouseEvent('drop', init), { dataTransfer }));
    return true;
  }

  /**
   * The picture `renderer` draws in place of the code, with what the picture extensions add; clicking it selects a box
   * with tools, else edits the code.
   */
  private createRendered(code: HTMLElement, renderer: RawBoxRenderer): RenderedBox {
    const activate = () => (this.spec?.tools ? this.select() : this.focus(-1));
    const extend = (picture: HTMLImageElement) => this.pictureExtensions.map((provider) => provider({ picture, editor: this.editor, src: () => this.node.attrs.src }));
    return new RenderedBox({ dom: this.dom, code, source: () => this.source(), activate, extend }, renderer);
  }

  /** What the box's tools get: the box, its picture (if rendered), the Tiptap editor and ours, how to edit the code. */
  private toolsHost(code: HTMLElement, editor: VisualEditorContext): RawBoxToolsHost {
    const picture = this.rendered?.picture ?? null;
    return { dom: this.dom, code, picture, tiptap: this.tiptap, editor, getPos: this.getPos, editCode: () => this.focus(-1) };
  }

  /** Hands the box's decorations (e.g. other users' carets in it) to its code's extensions (`setRawBoxDecorations`). */
  private showDecorations(decorations: readonly Decoration[]): void {
    this.code.dispatch({ effects: setRawBoxDecorations.of(decorations) });
  }

  /** The node and where its source starts, while the box is in the document. */
  private source(): { node: Node; from: SourceOffset } | null {
    const pos = this.getPos();
    return pos === undefined ? null : { node: this.node, from: posToSource(this.tiptap.state.doc, pos) };
  }

  private createLabel(node: Node): HTMLElement | null {
    const label = this.spec?.title;
    if (!label) return null;
    this.dom.classList.add(label.className);
    const element = this.dom.appendChild(this.dom.ownerDocument.createElement('div'));
    element.className = `zwf-visual__box-label ${label.className}-label`;
    element.textContent = label.text(node.attrs.src);
    return element;
  }

  private updateLabel(): void {
    if (this.label) this.label.textContent = this.spec!.title!.text(this.node.attrs.src);
  }

  /** Selects the box as a whole in the outer editor (a box with tools: shows them). */
  private select(): void {
    const pos = this.getPos();
    if (pos === undefined) return;
    const outer = this.tiptap.view;
    outer.dispatch(outer.state.tr.setSelection(NodeSelection.create(outer.state.doc, pos)));
    outer.focus();
  }

  private forward(trs: readonly CodeTransaction[], view: CodeView): void {
    view.update(trs);
    const pos = this.getPos();
    if (this.mirroring || pos === undefined || !trs.some((tr) => tr.docChanged)) return;
    const outer = this.tiptap.view;
    outer.dispatch(outer.state.tr.setNodeAttribute(pos, 'src', view.state.doc.toString()));
  }

  private keys(inline: boolean): KeyBinding[] {
    const head = () => this.code.state.selection.main;
    const doc = () => this.code.state.doc;
    const atStart = () => head().empty && head().head === 0;
    const atEnd = () => head().empty && head().head === doc().length;
    return [
      { key: 'Mod-z', run: () => (this.tiptap.commands.undo(), true) },
      { key: 'Mod-y', run: () => (this.tiptap.commands.redo(), true) },
      { key: 'Mod-Shift-z', run: () => (this.tiptap.commands.redo(), true) },
      { key: 'ArrowLeft', run: () => atStart() && this.leave(-1) },
      { key: 'ArrowRight', run: () => atEnd() && this.leave(1) },
      { key: 'ArrowUp', run: () => head().empty && doc().lineAt(head().head).number === 1 && this.leave(-1) },
      { key: 'ArrowDown', run: () => head().empty && doc().lineAt(head().head).number === doc().lines && this.leave(1) },
      { key: 'Escape', run: () => this.leave(1) },
      // stays in the editor: a block's code indents, an inline box's ignores it (Escape, then Tab leaves with the built-in tab-keys)
      { key: 'Tab', run: (view) => inline || indentMore(view), shift: (view) => inline || indentLess(view) },
      { key: 'Enter', run: () => inline && this.leave(1) },
      { key: 'Backspace', run: () => doc().length === 0 && this.remove() },
    ];
  }

  /** Moves the cursor into the outer editor, just before or after this box: into the gap there, else the text. */
  private leave(side: Side): boolean {
    const pos = this.getPos();
    if (pos === undefined) return false;
    const outer = this.tiptap.view;
    const $edge = outer.state.doc.resolve(side < 0 ? pos : pos + this.node.nodeSize);
    outer.dispatch(outer.state.tr.setSelection(blockGapAt($edge) ?? Selection.near($edge, side)).scrollIntoView());
    outer.focus();
    return true;
  }

  private remove(): boolean {
    const pos = this.getPos();
    if (pos === undefined) return false;
    const outer = this.tiptap.view;
    const tr = outer.state.tr.delete(pos, pos + this.node.nodeSize);
    const $at = tr.doc.resolve(Math.min(pos, tr.doc.content.size));
    outer.dispatch(tr.setSelection(blockGapAt($at) ?? Selection.near($at)).scrollIntoView());
    outer.focus();
    return true;
  }
}

/** The open raw boxes by their DOM, so arrow keys in the outer editor can move into them. */
const boxes = new WeakMap<globalThis.Node, RawBox>();

type Side = -1 | 1;

const sharedTheme = {
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: 'inherit' },
  '.cm-content': { padding: '0' },
  '.cm-line': { padding: '0' },
  '&.cm-focused': { outline: 'none' },
};

/**
 * Inline boxes must stay inline-level: CodeMirror's base theme makes the editor `display: flex !important`,
 * and a block inside the box's <span> splits it into three lines (before, the editor, after).
 */
const inlineTheme = CodeView.theme({
  ...sharedTheme,
  '&': { display: 'inline-flex !important', verticalAlign: 'baseline' },
  '.cm-scroller': { ...sharedTheme['.cm-scroller'], overflow: 'visible' },
});

const blockTheme = CodeView.theme(sharedTheme);

/** Arrow key handling in the outer editor: moving onto a raw box puts the cursor inside it. */
function enterBox(editor: Editor, dir: Direction): boolean {
  if (!editor.state.selection.empty) return false;
  const side: Side = dir === 'left' || dir === 'up' ? -1 : 1;
  const horizontal = dir === 'left' || dir === 'right';
  return (horizontal && enterInlineBox(editor, side)) || enterBlockBox(editor, dir, side);
}

type Direction = 'up' | 'down' | 'left' | 'right';

/** Left/right next to a raw inline box. */
function enterInlineBox({ state, view }: Editor, side: Side): boolean {
  const { $head } = state.selection;
  const neighbour = side > 0 ? $head.nodeAfter : $head.nodeBefore;
  if (neighbour?.type.name !== 'rawInline') return false;
  return focusBox(view, side > 0 ? $head.pos : $head.pos - neighbour.nodeSize, side);
}

function focusBox(view: EditorView, pos: number, side: Side): boolean {
  const box = boxAt(view, pos);
  box?.focus(side);
  return box !== undefined;
}

/** The raw box at `pos` in the outer editor, if one is shown there. */
function boxAt(view: EditorView, pos: number): RawBox | undefined {
  const dom = view.nodeDOM(pos);
  return dom ? boxes.get(dom) : undefined;
}

/** Leaving a textblock towards a raw block (the PM "embedded code editor" arrow handler). */
function enterBlockBox({ state, view }: Editor, dir: Direction, side: Side): boolean {
  const { $head } = state.selection;
  if ($head.depth === 0 || !view.endOfTextblock(dir)) return false;
  const next = Selection.near(state.doc.resolve(side > 0 ? $head.after() : $head.before()), side);
  return next instanceof NodeSelection && focusBox(view, next.from, side);
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    typstRawBoxNavigation: {
      /**
       * Shows and focuses the code of the raw box at `pos`, the cursor at offset `from` in its `src` (e.g. inside the
       * `$$` of a math box just inserted), or `from..to` selected (a match revealed in it). Run it after the transaction
       * that made the box: the box must be shown.
       */
      editRawBox: (pos: number, from: number, to?: number) => ReturnType;
    };
  }
}
