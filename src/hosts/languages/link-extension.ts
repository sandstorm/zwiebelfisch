// See Languages in languages.ts.
import type { EditorState, Extension, Range } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, hoverTooltip, keymap, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { ProjectPath } from '../../core/paths/paths';
import type { DocumentLink, FollowableLink, LinkTargets, TextDocument } from './languages';

/**
 * Makes the links of the editor's text navigable: while the modifier is held, a hovered link shows as one; Mod+click
 * or Alt+Enter on it opens its target (a file, at the link's selection, or a URL in a new tab), and the hover tooltip offers to open it ("Open …", or the link's tooltip, as
 * VS Code's "Follow link"), or says what the link's tooltip says and offers its command (e.g. "Create chapter.typ").
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
      keydown: (event, view) => trackMod(view, event),
      keyup: (event, view) => trackMod(view, event),
      mousemove: (event, view) => trackMod(view, event),
      blur: (_event, view) => trackMod(view, null),
    }),
    keymap.of([{ key: 'Alt-Enter', run: (view) => follow(view, view.state.selection.main.head) }]),
    hoverTooltip((view, pos) => {
      const link = linkAt(view, pos);
      const dom = link && linkInfo(view.dom.ownerDocument, actions.resolveDocumentLink(link), actions);
      return dom && link ? { pos: link.range.from, end: link.range.to, above: true, create: () => ({ dom }) } : null;
    }),
  ];
}

/** What the links come from, and where following one goes. */
export interface LinkActions extends LinkTargets {
  provideDocumentLinks(document: TextDocument): readonly DocumentLink[];
  resolveDocumentLink(link: DocumentLink): DocumentLink;
}

/**
 * What a (resolved) link offers, as a small piece of DOM: a button opening its target ("Open …", or its tooltip:
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
export function primaryLink(links: readonly DocumentLink[], actions: Pick<LinkActions, 'resolveDocumentLink' | 'open'>): FollowableLink | null {
  for (const link of links) {
    const followable = followableLink(link, actions);
    if (followable) return followable;
  }
  return null;
}

/**
 * `link`, if it leads somewhere, followed as in text: titled as the hover offers it, with the Mod+click hint; following
 * it resolves it again, so it goes where the link leads by then. Null: it leads nowhere.
 */
export function followableLink(link: DocumentLink, actions: Pick<LinkActions, 'resolveDocumentLink' | 'open'>): FollowableLink | null {
  const resolved = actions.resolveDocumentLink(link);
  if (!resolved.target) return null;
  const follow = () => {
    const now = actions.resolveDocumentLink(link);
    if (now.target) actions.open(now.target, now.selection);
  };
  return { title: `${followLabel(resolved, resolved.target)} ${FOLLOW_HINT}`, isFollowEvent: isMod, follow };
}

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

function isMod(event: MouseEvent | KeyboardEvent): boolean {
  return MAC ? event.metaKey : event.ctrlKey;
}

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** `typst-source--mod` on the editor while the modifier is held: links show the pointer. */
function trackMod(view: EditorView, event: MouseEvent | KeyboardEvent | null): boolean {
  view.dom.classList.toggle('typst-source--mod', event !== null && isMod(event));
  return false;
}

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

/** How to follow a link, as people read it: the modifier that turns a click into "follow", or the key. */
const FOLLOW_HINT = `(${MAC ? '⌘+click' : 'Ctrl+click'} or Alt+Enter)`;
