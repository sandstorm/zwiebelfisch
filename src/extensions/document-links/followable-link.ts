// See documentLinks in document-links.ts.
import { ProjectPath } from '../../core/paths/paths';
import type { SourceOffset, SourceRange } from '../../core/typst-document/typst-document';
import type { DocumentLink, TextDocument } from '../../hosts/languages/languages';
import { FOLLOW_HINT, isMod, type HoveredLink } from './link-hover';

/** Where links come from (the host's merged providers), where following one goes, and the hover that shows them. */
export interface LinkActions {
  provideDocumentLinks(document: TextDocument): readonly DocumentLink[];
  resolveDocumentLink(link: DocumentLink): DocumentLink;
  /** Shows a link's target: a project file (at `selection`, if given), or an external URL in a new tab. */
  open(target: ProjectPath | URL, selection?: SourceRange): void;
  /** Runs a link's command (`commands.executeCommand`). */
  executeCommand(command: string, ...args: unknown[]): Promise<unknown>;
  /** The pointer moved (`event`) over `hovered`, or over no link (null): the widget's `LinkHover.move`. */
  hoverLink(event: MouseEvent, hovered: HoveredLink | null): void;
}

/** A link as something other than a CodeMirror editor follows it (a raw box's picture, the Visual editor's text). */
export interface FollowableLink {
  /** Whether a click with `event`'s modifiers follows it, as on links in text (⌘ on Mac, else Ctrl). */
  isFollowEvent(event: MouseEvent | KeyboardEvent): boolean;
  /** Opens its target (resolved again: a label may have moved since). */
  follow(): void;
  /**
   * The pointer moved (`event`) over it at `element` (a reference chip, a link's text, a picture): it shows as links in
   * text do, the same hint after the same delay ("Edit diagram (⌘+click or Alt+Enter)", `.zwf-link-hint`) and,
   * while the modifier is held, the link look (`zwf-link--mod` on `element`).
   */
  hover(event: MouseEvent, element: Element): void;
  /** The pointer (`event`) left it: its hint goes (unless the pointer moves into it), and its link look. */
  leave(event: MouseEvent): void;
}

/** What a link followed outside CodeMirror needs: resolving it, and its targets (its hint offers its command). */
type FollowActions = Pick<LinkActions, 'resolveDocumentLink' | 'open' | 'executeCommand' | 'hoverLink'>;

/**
 * What a (resolved) link offers, as a small piece of DOM (the content of its hint): a button opening its target ("Open …", or its tooltip:
 * "Edit diagram") with the Mod+click hint, else its tooltip; and a button for its command that shows the error's
 * message when the command rejects. Null when it offers nothing.
 */
export function linkInfo(doc: Document, link: DocumentLink, actions: Pick<LinkActions, 'open' | 'executeCommand'>): HTMLElement | null {
  const { target, selection, tooltip, command } = link;
  if (!target && !tooltip && !command) return null;
  const info = doc.createElement('span');
  info.className = 'zwf-file-link';
  if (target) info.append(button(doc, followLabel(link, target), () => actions.open(target, selection)), note(doc, FOLLOW_HINT));
  else if (tooltip) info.append(note(doc, tooltip));
  if (command) {
    const error = note(doc, '');
    error.classList.add('zwf-file-link__error');
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

/**
 * The primary link of `document`: the first, in text order, that leads somewhere, as `followableLink` makes it; null:
 * none does. A provider makes its link the primary one on a range by its `priority` (overlapping links: the higher
 * wins), so no link needs a mark. For what shows a text other than as text (a raw box's picture).
 */
export function primaryLink(document: TextDocument, actions: LinkActions): FollowableLink | null {
  for (const link of actions.provideDocumentLinks(document)) {
    const followable = followableLink(link, actions);
    if (followable) return followable;
  }
  return null;
}

/**
 * Finds the link at `offset` of `document` (its range including both ends) that leads somewhere, or null: for an
 * editor that shows the text other than as text (the Visual editor), asked as the pointer moves. The links of the last
 * document asked about are kept until its text changes; each is resolved anew (a label may have come or gone).
 */
export function linkFinder(actions: LinkActions): (document: TextDocument, offset: SourceOffset) => FollowableLink | null {
  let last: (TextDocument & { links: readonly DocumentLink[] }) | null = null;
  return (document, offset) => {
    const same = last && last.path === document.path && last.languageId === document.languageId && last.text === document.text;
    const links = same && last ? last.links : actions.provideDocumentLinks(document);
    last = { ...document, links };
    const link = links.find(({ range }) => range.from <= offset && offset <= range.to);
    return link ? followableLink(link, actions) : null;
  };
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
    hover: (event, element) => actions.hoverLink(event, { link, element, followable: true, hint: () => linkInfo(element.ownerDocument, resolved, actions) }),
    leave: (event) => actions.hoverLink(event, null),
  };
}

/** What following a link to `target` does, in words: its tooltip, else "Open <file>" or "Open <URL>". */
function followLabel(link: DocumentLink, target: ProjectPath | URL): string {
  return link.tooltip ?? `Open ${target instanceof URL ? target.href : ProjectPath.displayName(target)}`;
}

function button(doc: Document, label: string, onClick: () => void): HTMLButtonElement {
  const element = doc.createElement('button');
  element.type = 'button';
  element.className = 'zwf-file-link__button';
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
  element.className = 'zwf-file-link__note';
  element.textContent = text;
  return element;
}
