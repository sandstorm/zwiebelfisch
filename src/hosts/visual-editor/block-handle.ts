// The handle beside a block, to drag it elsewhere. See VisualEditor in visual-editor-impl.ts.
import { Extension } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { NodeSelection, Plugin, type EditorState, type PluginView } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

/**
 * A grip (six dots) in the left margin beside the block under the pointer, as in Notion: dragging it moves the block,
 * clicking it selects the block. A block is a top-level one or a list item, at any depth.
 *
 * A move is one undo step and keeps the block's Typst verbatim. The grip hides while typing, in a read-only editor, and
 * when the pointer leaves the text and the grip.
 */
export const BlockHandle = Extension.create({
  name: 'typstBlockHandle',
  addProseMirrorPlugins() {
    return [new Plugin({ view: (view) => new Grip(view) })];
  },
});

/** A block with a handle: the node, where it starts, and where the list starts that holds it (if it is an item). */
interface Block {
  readonly node: Node;
  readonly pos: number;
  readonly list: number | null;
}

/** The grip's size and its gap to the block's left edge (px; as visual-editor.css): it sits in the text column's left padding. */
const WIDTH = 18;
const HEIGHT = 24;
const GAP = 6;

class Grip implements PluginView {
  private readonly dom: HTMLElement;
  /** The block the grip is shown for, `null` while it is hidden. */
  private block: Block | null = null;
  private readonly listeners: [EventTarget, string, (event: never) => void][];

  constructor(private readonly view: EditorView) {
    const doc = view.dom.ownerDocument;
    this.dom = doc.createElement('div');
    this.dom.className = 'zwf-visual__block-handle';
    this.dom.draggable = true;
    this.dom.hidden = true;
    this.dom.title = 'Drag to move, click to select';
    this.dom.innerHTML =
      '<svg viewBox="0 0 10 16" width="10" height="16" fill="currentColor" aria-hidden="true">' +
      '<circle cx="2.5" cy="3" r="1.5"/><circle cx="7.5" cy="3" r="1.5"/><circle cx="2.5" cy="8" r="1.5"/>' +
      '<circle cx="7.5" cy="8" r="1.5"/><circle cx="2.5" cy="13" r="1.5"/><circle cx="7.5" cy="13" r="1.5"/></svg>';
    // in the text column beside the editor's DOM, placed relative to it: it scrolls with the text
    view.dom.after(this.dom);
    const leave = (event: MouseEvent) => {
      const to = event.relatedTarget as globalThis.Node | null;
      if (!to || !(view.dom.contains(to) || this.dom.contains(to))) this.hide();
    };
    this.listeners = [
      [view.dom, 'mousemove', (event: MouseEvent) => this.show(event.clientY)],
      [view.dom, 'mouseleave', leave],
      [view.dom, 'keydown', () => this.hide()],
      [this.dom, 'mouseleave', leave],
      [this.dom, 'click', () => this.select()],
      [this.dom, 'dragstart', (event: DragEvent) => this.drag(event)],
    ];
    for (const [target, type, listener] of this.listeners) target.addEventListener(type, listener as EventListener);
  }

  update(view: EditorView, previous: EditorState): void {
    // the block's position is stale (the next move of the pointer shows it again)
    if (view.state.doc !== previous.doc) this.hide();
  }

  destroy(): void {
    for (const [target, type, listener] of this.listeners) target.removeEventListener(type, listener as EventListener);
    this.dom.remove();
  }

  /** Shows the grip beside the block at height `y` (client coordinates). */
  private show(y: number): void {
    const block = this.view.editable ? blockAt(this.view, y) : null;
    const dom = block && this.domOf(block.pos);
    if (!block || !dom) return this.hide();
    this.block = block;
    // the text column (`position: relative`)
    const origin = this.dom.parentElement!.getBoundingClientRect();
    const rect = dom.getBoundingClientRect();
    const left = block.list === null ? rect.left : (this.domOf(block.list)?.getBoundingClientRect().left ?? rect.left);
    const style = getComputedStyle(dom);
    // centred on the first line (a line height of `normal`: on the grip's height)
    const line = Math.min(parseFloat(style.lineHeight) || HEIGHT, rect.height);
    this.dom.style.top = `${rect.top - origin.top + (parseFloat(style.paddingTop) || 0) + (line - HEIGHT) / 2}px`;
    this.dom.style.left = `${left - origin.left - WIDTH - GAP}px`;
    this.dom.hidden = false;
  }

  private hide(): void {
    this.block = null;
    this.dom.hidden = true;
  }

  /** Selects the block (the grip clicked). */
  private select(): void {
    if (!this.block) return;
    this.view.dispatch(this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, this.block.pos)));
    this.view.focus();
  }

  /**
   * Starts dragging the block, as ProseMirror starts dragging a selected node (its `dragstart`, which the grip outside
   * the editor's DOM does not reach): the block selected, its HTML and Typst in the drag's data, `view.dragging` saying
   * what moves where it is dropped. The picture dragged is the block's.
   */
  private drag(event: DragEvent): void {
    const { view, block } = this;
    const data = event.dataTransfer;
    if (!block || !data) return;
    const selection = NodeSelection.create(view.state.doc, block.pos);
    view.dispatch(view.state.tr.setSelection(selection));
    const { dom, text, slice } = view.serializeForClipboard(selection.content());
    data.clearData();
    data.setData('text/html', dom.innerHTML);
    data.setData('text/plain', text);
    data.effectAllowed = 'copyMove';
    const picture = this.domOf(block.pos);
    if (picture) data.setDragImage(picture, 0, event.clientY - picture.getBoundingClientRect().top);
    // ProseMirror's own shape (its Dragging): `node` is what a move deletes, whatever is selected by then
    const dragging = { slice, move: true, node: selection };
    view.dragging = dragging;
    // a drag that ends without a drop in the editor (cancelled, dropped elsewhere): as ProseMirror's `dragend`
    this.dom.addEventListener('dragend', () => setTimeout(() => {
      if (view.dragging === dragging) view.dragging = null;
    }, 50), { once: true });
  }

  private domOf(pos: number): HTMLElement | null {
    const dom = this.view.nodeDOM(pos);
    return dom instanceof HTMLElement ? dom : null;
  }
}

/**
 * The block with a handle at height `y`: the last top-level block or item of a top-level list starting above it (the
 * first one if none), then, while that is an item, the last item of its nested lists starting above `y`. Blocks are found by halving
 * (their DOM is read only for those compared), so long documents stay quick under a moving pointer.
 */
function blockAt(view: EditorView, y: number): Block | null {
  const top = (pos: number) => {
    const dom = view.nodeDOM(pos);
    return dom instanceof HTMLElement ? dom.getBoundingClientRect().top : Infinity;
  };
  let found: Block | null = null;
  for (let blocks = blocksIn(view.state.doc, 0, true); blocks.length > 0;) {
    // the last block whose top is at or above y
    let [low, high] = [0, blocks.length];
    while (low < high) {
      const mid = (low + high) >> 1;
      if (top(blocks[mid].pos) <= y) low = mid + 1;
      else high = mid;
    }
    if (low === 0 && found) break;
    found = blocks[Math.max(low - 1, 0)];
    blocks = found.list === null ? [] : blocksIn(found.node, found.pos + 1, false);
  }
  return found;
}

/**
 * The blocks with a handle in `parent` (its content starting at `start`): the items of its lists, and its other
 * children if it is the document (`top`).
 */
function blocksIn(parent: Node, start: number, top: boolean): Block[] {
  const blocks: Block[] = [];
  parent.forEach((child, offset) => {
    const pos = start + offset;
    if (child.type.isInGroup('list')) child.forEach((item, at) => blocks.push({ node: item, pos: pos + 1 + at, list: pos }));
    else if (top) blocks.push({ node: child, pos, list: null });
  });
  return blocks;
}
