// See Languages in languages.ts.
import type { EditorState, Extension, Range } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, keymap, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { ProjectPath } from '../../core/paths/paths';
import type { DocumentLink, FollowableLink, LinkTargets, TextDocument } from './languages';
import { FOLLOW_HINT, hoverLink, isMod } from './link-hover';

/**
 * Makes the links of the editor's text navigable: Mod+click or Alt+Enter on one opens its target (a file, at the
 * link's selection, or a URL in a new tab). Hovered, it shows as every link does (`hoverLink`): its hint offers to open
 * it ("Open …", or the link's tooltip, as VS Code's "Follow link"), or says what the link's tooltip says and offers its
 * command (e.g. "Create chapter.typ"); while the modifier is held it shows as a link.
 * `languageId`: the text's language; `path`: the file the text is in, now (a file can be renamed); null: none, the
 * text has no links.
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
    const mark = event.buttons === 0 && event.target instanceof Element ? event.target.closest('.typst-source__path') : null;
    const link = mark && view.contentDOM.contains(mark) ? linkAt(view, view.posAtDOM(mark)) : null;
    if (!link || !mark) return hoverLink(event, null);
    const resolved = actions.resolveDocumentLink(link);
    // the editor carries the link look: CodeMirror owns the mark's DOM
    hoverLink(event, { link, element: mark, marked: view.dom, followable: Boolean(resolved.target), hint: () => linkInfo(view.dom.ownerDocument, resolved, actions) });
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
      mouseleave: (event) => hoverLink(event, null),
    }),
    keymap.of([{ key: 'Alt-Enter', run: (view) => follow(view, view.state.selection.main.head) }]),
  ];
}

/** What the links come from, and where following one goes. */
export interface LinkActions extends LinkTargets {
  provideDocumentLinks(document: TextDocument): readonly DocumentLink[];
  resolveDocumentLink(link: DocumentLink): DocumentLink;
}

/**
 * What a (resolved) link offers, as a small piece of DOM (the content of its hint): a button opening its target ("Open …", or its tooltip:
 * "Edit diagram") with the Mod+click hint, else its tooltip; and a button for its command that shows the error's
 * message when the command rejects. Null when it offers nothing.
 */
export function linkInfo(doc: Document, link: DocumentLink, actions: Pick<LinkActions, 'open' | 'executeCommand'>): HTMLElement | null {
  const { target, selection, tooltip, command } = link;
  if (!target && !tooltip && !command) return null;
  const info = doc.createElement('span');
  info.className = 'typst-file-link';
  if (target) info.append(button(doc, followLabel(link, target), () => actions.open(target, selection)), note(doc, FOLLOW_HINT));
  else if (tooltip) info.append(note(doc, tooltip));
  if (command) {
    const error = note(doc, '');
    error.classList.add('typst-file-link__error');
    error.setAttribute('role', 'alert');
    const run = () => {
      error.textContent = '';
      actions.executeCommand(command.command, ...(command.arguments ?? [])).catch((failure: unknown) => {
        error.textContent = failure instanceof Error ? failure.message : String(failure);
      });
    };
    info.append(button(doc, command.title, run), error);
  }
  return info;
}

/** The first of `links` (in text order) that leads somewhere, as `followableLink` makes it; null: none does. */
export function primaryLink(links: readonly DocumentLink[], actions: FollowActions): FollowableLink | null {
  for (const link of links) {
    const followable = followableLink(link, actions);
    if (followable) return followable;
  }
  return null;
}

/**
 * `link`, if it leads somewhere, followed as in text: hovered, it shows the hint of links in text; following it
 * resolves it again, so it goes where the link leads by then. Null: it leads nowhere.
 */
export function followableLink(link: DocumentLink, actions: FollowActions): FollowableLink | null {
  const resolved = actions.resolveDocumentLink(link);
  if (!resolved.target) return null;
  const follow = () => {
    const now = actions.resolveDocumentLink(link);
    if (now.target) actions.open(now.target, now.selection);
  };
  return {
    isFollowEvent: isMod,
    follow,
    hover: (event, element) => hoverLink(event, { link, element, followable: true, hint: () => linkInfo(element.ownerDocument, resolved, actions) }),
    leave: (event) => hoverLink(event, null),
  };
}

/** What a link followed outside CodeMirror needs: resolving it, and its targets (its hint offers its command). */
type FollowActions = Pick<LinkActions, 'resolveDocumentLink' | 'open' | 'executeCommand'>;

/** What following a link to `target` does, in words: its tooltip, else "Open <file>" or "Open <URL>". */
function followLabel(link: DocumentLink, target: ProjectPath | URL): string {
  return link.tooltip ?? `Open ${target instanceof URL ? target.href : ProjectPath.displayName(target)}`;
}

/** The links of the editor's text, in the file at `path` (none: no links). */
function linksOf(state: EditorState, actions: LinkActions, languageId: string, path: ProjectPath | null): readonly DocumentLink[] {
  return path ? actions.provideDocumentLinks({ path, languageId, text: state.doc.toString() }).filter((link) => link.range.to <= state.doc.length) : [];
}

function decorate(links: readonly DocumentLink[]): DecorationSet {
  const ranges: Range<Decoration>[] = links.flatMap(({ range }) => (range.from < range.to ? [linkMark.range(range.from, range.to)] : []));
  return Decoration.set(ranges, true);
}

const linkMark = Decoration.mark({ class: 'typst-source__path' });

function button(doc: Document, label: string, onClick: () => void): HTMLButtonElement {
  const element = doc.createElement('button');
  element.type = 'button';
  element.className = 'typst-file-link__button';
  element.textContent = label;
  // Keep the editor's focus and selection; act on click.
  element.addEventListener('mousedown', (event) => event.preventDefault());
  element.addEventListener('click', (event) => {
    event.stopPropagation();
    onClick();
  });
  return element;
}

function note(doc: Document, text: string): HTMLElement {
  const element = doc.createElement('span');
  element.className = 'typst-file-link__note';
  element.textContent = text;
  return element;
}
