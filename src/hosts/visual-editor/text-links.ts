// See VisualEditorLinks in visual-editor.ts.
import { Extension } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { NodeSelection, Plugin } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { SourceOffset, TypstDocument } from '../../core/typst-document/typst-document';
import { posToSource } from '../prosemirror-typst/prosemirror-typst';
import type { FollowableLink, VisualEditorLinks } from './visual-editor';

/**
 * Follows the links in the text of `document`'s editor as the Source editor does: hovered, one shows as every link
 * (`FollowableLink.hover`: its hint, with Mod held the link look), and Mod+click on it or Alt+Enter at the cursor
 * follows it. A plain click edits as ever. The link at a place is `links.linkAt` at the source offset of what is
 * there: an inline atom (a reference chip) or the text of an inline element (a link mark). Boxes (`isBox`) follow
 * their own links.
 */
export function textLinks(document: TypstDocument, links: VisualEditorLinks, isBox: (node: Node) => boolean): Extension {
  const linkAt = (offset: SourceOffset | null) => (offset === null ? null : links.linkAt(document, offset));
  /** The link under the pointer, and the element that shows it. */
  const linkUnder = (view: EditorView, event: MouseEvent) => {
    const under = elementUnder(view, event);
    const link = under && linkAt(posToSource(view.state.doc, under.pos));
    return link && under ? { link, element: under.element } : null;
  };
  return Extension.create({
    name: 'typstTextLinks',
    addProseMirrorPlugins() {
      return [
        new Plugin({
          view: (view) => new HoveredLink(view, (event) => linkUnder(view, event)),
          props: {
            handleDOMEvents: {
              mousedown: (view, event) => {
                const link = event.button === 0 ? linkUnder(view, event)?.link : null;
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

/** The link under the pointer shows as one (`FollowableLink.hover`); a plain move elsewhere leaves it. */
class HoveredLink {
  #link: FollowableLink | null = null;
  readonly #move = (event: MouseEvent) => this.#hover(event.buttons === 0 ? this.linkUnder(event) : null, event);
  readonly #leave = (event: MouseEvent) => this.#hover(null, event);

  constructor(
    private readonly view: EditorView,
    private readonly linkUnder: (event: MouseEvent) => { link: FollowableLink; element: Element } | null,
  ) {
    view.dom.addEventListener('mousemove', this.#move);
    view.dom.addEventListener('mouseleave', this.#leave);
  }

  destroy(): void {
    this.view.dom.removeEventListener('mousemove', this.#move);
    this.view.dom.removeEventListener('mouseleave', this.#leave);
  }

  #hover(under: { link: FollowableLink; element: Element } | null, event: MouseEvent): void {
    if (under) under.link.hover(event, under.element);
    else this.#link?.leave(event);
    this.#link = under?.link ?? null;
  }
}

/**
 * What is under the pointer: an inline atom (a reference chip: its start and its element), or a place in the text of
 * an inline element (a link mark's: the outermost inline element there, which shows the link); null elsewhere (a
 * block's margin, the space after a line).
 */
function elementUnder(view: EditorView, event: MouseEvent): { pos: number; element: Element } | null {
  const found = view.posAtCoords({ left: event.clientX, top: event.clientY });
  if (!found) return null;
  const { doc } = view.state;
  const atom = found.inside >= 0 ? doc.nodeAt(found.inside) : null;
  const atomDom = atom?.isInline && atom.isAtom ? view.nodeDOM(found.inside) : null;
  if (atomDom instanceof Element) return { pos: found.inside, element: atomDom };
  const $pos = doc.resolve(found.pos);
  if (!$pos.parent.inlineContent || $pos.depth === 0) return null;
  // the text's element: domAtPos at the start of a textblock is its content element
  const element = outermostIn(view.domAtPos($pos.start()).node, event.target);
  return element && { pos: found.pos, element };
}

/** The child of `parent` that holds `target`; null: `target` is not inside `parent` (or is it). */
function outermostIn(parent: globalThis.Node, target: EventTarget | null): Element | null {
  if (!(target instanceof Element) || target === parent || !parent.contains(target)) return null;
  let element = target;
  while (element.parentElement && element.parentElement !== parent) element = element.parentElement;
  return element;
}

/** The source offset of the cursor, or of the selected inline atom (a reference chip); null for other selections and boxes. */
function offsetAtCursor(view: EditorView, isBox: (node: Node) => boolean): SourceOffset | null {
  const { selection, doc } = view.state;
  if (selection instanceof NodeSelection) return selection.node.isInline && !isBox(selection.node) ? posToSource(doc, selection.from) : null;
  return selection.empty ? posToSource(doc, selection.head) : null;
}
