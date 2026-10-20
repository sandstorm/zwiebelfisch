// See documentLinks in ../document-links.ts.
import type { EditorState, Extension, Range } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, keymap, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import type { ProjectPath } from '../../../core/paths/paths';
import type { DocumentLink } from '../../../hosts/languages/languages';
import { linkInfo, type LinkActions } from '../followable-link';
import { isMod } from '../link-hover';

/**
 * Makes the links of a CodeMirror editor's text navigable: Mod+click or Alt+Enter on one opens its target (a file at
 * the link's selection, or a URL in a new tab). Hovered, a link shows its hint ("Open …", or its tooltip and command,
 * e.g. "Create chapter.typ"), and the link look while the modifier is held.
 * `languageId`: the text's language; `path`: the file the text is in, now (a file can be renamed); null: the text has
 * no links.
 */
export function linkExtension(actions: LinkActions, languageId: string, path: () => ProjectPath | null): Extension {
  const links = ViewPlugin.fromClass(
    class {
      links: readonly DocumentLink[];
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.links = linksOf(view.state, actions, languageId, path());
        this.decorations = decorate(this.links);
      }
      update(update: ViewUpdate) {
        if (!update.docChanged) return;
        this.links = linksOf(update.state, actions, languageId, path());
        this.decorations = decorate(this.links);
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
  const linkAt = (view: EditorView, pos: number) => view.plugin(links)?.links.find((link) => link.range.from <= pos && pos <= link.range.to) ?? null;
  const follow = (view: EditorView, pos: number) => {
    const link = linkAt(view, pos);
    const resolved = link && actions.resolveDocumentLink(link);
    if (resolved?.target) actions.open(resolved.target, resolved.selection);
    return Boolean(resolved?.target);
  };
  const hover = (event: MouseEvent, view: EditorView) => {
    const mark = event.buttons === 0 && event.target instanceof Element ? event.target.closest('.zwf-source__path') : null;
    const link = mark && view.contentDOM.contains(mark) ? linkAt(view, view.posAtDOM(mark)) : null;
    if (!link || !mark) return actions.hoverLink(event, null);
    const resolved = actions.resolveDocumentLink(link);
    // the editor carries the link look: CodeMirror owns the mark's DOM
    actions.hoverLink(event, { link, element: mark, marked: view.dom, followable: Boolean(resolved.target), hint: () => linkInfo(view.dom.ownerDocument, resolved, actions) });
  };
  return [
    links,
    EditorView.domEventHandlers({
      mousedown: (event, view) => {
        if (event.button !== 0 || !isMod(event)) return false;
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos === null || !follow(view, pos)) return false;
        event.preventDefault();
        return true;
      },
      mousemove: (event, view) => void hover(event, view),
      mouseleave: (event) => actions.hoverLink(event, null),
    }),
    keymap.of([{ key: 'Alt-Enter', run: (view) => follow(view, view.state.selection.main.head) }]),
  ];
}

/** The links of the editor's text, in the file at `path` (none: no links). */
function linksOf(state: EditorState, actions: LinkActions, languageId: string, path: ProjectPath | null): readonly DocumentLink[] {
  return path ? actions.provideDocumentLinks({ path, languageId, text: state.doc.toString() }).filter((link) => link.range.to <= state.doc.length) : [];
}

function decorate(links: readonly DocumentLink[]): DecorationSet {
  const ranges: Range<Decoration>[] = links.flatMap(({ range }) => (range.from < range.to ? [linkMark.range(range.from, range.to)] : []));
  return Decoration.set(ranges, true);
}

const linkMark = Decoration.mark({ class: 'zwf-source__path' });
