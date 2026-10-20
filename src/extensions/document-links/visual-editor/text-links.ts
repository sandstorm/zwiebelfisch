// See documentLinks in ../document-links.ts.
import { Extension } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { NodeSelection, Plugin } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { ProjectPath } from '../../../core/paths/paths';
import type { SourceOffset } from '../../../core/typst-document/typst-document';
import type { TextDocument } from '../../../hosts/languages/languages';
import type { RawBoxContext, VisualEditorContext } from '../../../hosts/visual-editor/visual-editor';
import { posToSource } from '../../../hosts/visual-editor/typst-conversion/typst-conversion';
import { Disposable } from '../../../core/disposable/disposable';
import { linkFinder, primaryLink, type FollowableLink, type LinkActions } from '../followable-link';

/**
 * Follows the links in the text of `editor` as the Source editor does: hovered, a link shows its hint (with Mod held,
 * the link look), and Mod+click on it or Alt+Enter at the cursor follows it. A plain click edits as ever. Links are
 * found at inline atoms (a reference chip) and inline elements (a link mark); Alt+Enter on a selected box follows the
 * primary link of its Typst (`boxLink`). `path` is the file the editor's document is, now (null: no links).
 */
export function textLinks(editor: VisualEditorContext, actions: LinkActions, path: () => ProjectPath | null): Extension {
  const find = linkFinder(actions);
  const linkAt = (offset: SourceOffset | null) => {
    const file = path();
    return offset === null || !file ? null : find({ path: file, languageId: 'typst', text: editor.document.text }, offset);
  };
  /** The link under the pointer, and the element that shows it. */
  const linkUnder = (view: EditorView, event: MouseEvent) => {
    const under = elementUnder(view, event);
    const link = under && linkAt(posToSource(view.state.doc, under.pos));
    return link && under ? { link, element: under.element } : null;
  };
  const isBox = (node: Node) => editor.isBox(node);
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
              const { selection } = view.state;
              const box = selection instanceof NodeSelection && isBox(selection.node) ? selection.node.attrs.src : undefined;
              const link = typeof box === 'string' ? boxLink(box, actions, path) : linkAt(offsetAtCursor(view, editor));
              link?.follow();
              return link !== null;
            },
          },
        }),
      ];
    },
  });
}

/**
 * Makes the picture of a raw box lead where the box's Typst links to (`boxLink`), as a link in text: hovered, the hint
 * of every link (the link asked once per visit: finding it takes a parse); Mod+click follows it, instead of opening
 * the box. Null for a box without a picture.
 */
export function pictureLink({ picture, src }: RawBoxContext, actions: LinkActions, path: () => ProjectPath | null): Disposable | null {
  if (!picture) return null;
  let link: FollowableLink | null = null;
  const listeners: [string, (event: MouseEvent) => void][] = [
    [
      'mousedown',
      (event) => {
        const followed = event.button === 0 ? boxLink(src(), actions, path) : null;
        if (!followed?.isFollowEvent(event)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        followed.follow();
      },
    ],
    [
      'mouseenter',
      (event) => {
        link = boxLink(src(), actions, path);
        link?.hover(event, picture);
      },
    ],
    ['mousemove', (event) => link?.hover(event, picture)],
    [
      'mouseleave',
      (event) => {
        link?.leave(event);
        link = null;
      },
    ],
  ];
  for (const [type, listener] of listeners) picture.addEventListener(type, listener as EventListener);
  return new Disposable(() => {
    for (const [type, listener] of listeners) picture.removeEventListener(type, listener as EventListener);
  });
}

/** The primary link of the box whose Typst is `src`, in the file at `path`; null: none, or no file. */
function boxLink(src: string, actions: LinkActions, path: () => ProjectPath | null): FollowableLink | null {
  const file = path();
  // the providers read Typst markup; a figure's body is written in code (`image(..)`, no `#`)
  const document: TextDocument | null = file && { path: file, languageId: 'typst', text: src.startsWith('#') ? src : `#${src}` };
  return document && primaryLink(document, actions);
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
function offsetAtCursor(view: EditorView, editor: VisualEditorContext): SourceOffset | null {
  const { selection, doc } = view.state;
  if (selection instanceof NodeSelection) return selection.node.isInline && !editor.isBox(selection.node) ? posToSource(doc, selection.from) : null;
  return selection.empty ? posToSource(doc, selection.head) : null;
}
