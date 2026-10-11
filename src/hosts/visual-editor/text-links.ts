// See VisualEditorLinks in visual-editor.ts.
import { Extension } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { NodeSelection, Plugin } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { SourceOffset, TypstDocument } from '../../core/typst-document/typst-document';
import { posToSource } from '../prosemirror-typst/prosemirror-typst';
import type { FollowableLink, VisualEditorLinks } from './visual-editor';

/**
 * Follows the links in the text of `document`'s editor as the Source editor does: hovering one shows where it leads
 * (the editor's title), with Mod held it shows as one (`typst-visual--link`: the pointer), and Mod+click on it or
 * Alt+Enter at the cursor follows it. A plain click edits as ever. The link at a place is `links.linkAt` at the
 * source offset of what is there: an inline atom (a reference chip) or the text of an inline element (a link mark).
 * Boxes (`isBox`) follow their own links.
 */
export function textLinks(document: TypstDocument, links: VisualEditorLinks, isBox: (node: Node) => boolean): Extension {
  const linkAt = (offset: SourceOffset | null) => (offset === null ? null : links.linkAt(document, offset));
  return Extension.create({
    name: 'typstTextLinks',
    addProseMirrorPlugins() {
      return [
        new Plugin({
          view: (view) => new HoveredLink(view, (event) => linkAt(offsetUnder(view, event))),
          props: {
            handleDOMEvents: {
              mousedown: (view, event) => {
                const link = event.button === 0 ? linkAt(offsetUnder(view, event)) : null;
                if (!link?.isFollowEvent(event)) return false;
                event.preventDefault();
                link.follow();
                return true;
              },
            },
            handleKeyDown: (view, event) => {
              if (event.key !== 'Enter' || !event.altKey || event.shiftKey || event.ctrlKey || event.metaKey) return false;
              const link = linkAt(offsetAtCursor(view, isBox));
              link?.follow();
              return link !== null;
            },
          },
        }),
      ];
    },
  });
}

/** The link under the pointer: the editor's title says where it leads; with Mod held, the editor shows it as one. */
class HoveredLink {
  #link: FollowableLink | null = null;
  readonly #move = (event: MouseEvent) => this.#hover(event.buttons === 0 ? this.linkUnder(event) : null, event);
  readonly #leave = () => this.#hover(null, null);
  /** Mod pressed or let go without moving the mouse: the keys go to the document. */
  readonly #key = (event: KeyboardEvent) => this.#showMod(event);

  constructor(
    private readonly view: EditorView,
    private readonly linkUnder: (event: MouseEvent) => FollowableLink | null,
  ) {
    view.dom.addEventListener('mousemove', this.#move);
    view.dom.addEventListener('mouseleave', this.#leave);
  }

  destroy(): void {
    this.#hover(null, null);
    this.view.dom.removeEventListener('mousemove', this.#move);
    this.view.dom.removeEventListener('mouseleave', this.#leave);
  }

  #hover(link: FollowableLink | null, event: MouseEvent | null): void {
    if (link) this.view.dom.title = link.title;
    else if (this.#link) this.view.dom.removeAttribute('title');
    if (link && !this.#link) for (const type of ['keydown', 'keyup'] as const) this.view.dom.ownerDocument.addEventListener(type, this.#key);
    if (!link && this.#link) for (const type of ['keydown', 'keyup'] as const) this.view.dom.ownerDocument.removeEventListener(type, this.#key);
    this.#link = link;
    this.#showMod(event);
  }

  #showMod(event: MouseEvent | KeyboardEvent | null): void {
    this.view.dom.classList.toggle('typst-visual--link', event !== null && (this.#link?.isFollowEvent(event) ?? false));
  }
}

/**
 * The source offset of what is under the pointer: the start of an inline atom (a reference chip), or the place in the
 * text of an inline element (a link mark's); null elsewhere (a block's margin, the space after a line).
 */
function offsetUnder(view: EditorView, event: MouseEvent): SourceOffset | null {
  const found = view.posAtCoords({ left: event.clientX, top: event.clientY });
  if (!found) return null;
  const { doc } = view.state;
  const atom = found.inside >= 0 ? doc.nodeAt(found.inside) : null;
  if (atom?.isInline && atom.isAtom) return posToSource(doc, found.inside);
  const $pos = doc.resolve(found.pos);
  if (!$pos.parent.inlineContent || $pos.depth === 0 || event.target === view.nodeDOM($pos.before())) return null;
  return posToSource(doc, found.pos);
}

/** The source offset of the cursor, or of the selected inline atom (a reference chip); null for other selections and boxes. */
function offsetAtCursor(view: EditorView, isBox: (node: Node) => boolean): SourceOffset | null {
  const { selection, doc } = view.state;
  if (selection instanceof NodeSelection) return selection.node.isInline && !isBox(selection.node) ? posToSource(doc, selection.from) : null;
  return selection.empty ? posToSource(doc, selection.head) : null;
}
