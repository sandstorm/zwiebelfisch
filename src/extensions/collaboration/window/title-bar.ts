// The room in the title bar: the GitLab project, branch and folder it holds, and who else is in it. See collaboration
// in ../collaboration.ts.
import { initials, type Participant } from '../presence/presence';
import type { GitLabRoom } from '../room-protocol';

/** "demo/report  ⎇ main  /chapters": a GitLab room's project, branch and (in a room of one folder) folder. */
export function roomTitle(doc: Document, room: GitLabRoom): HTMLElement {
  const element = doc.createElement('div');
  element.className = 'zwf-collaboration__room';
  const part = (className: string, text: string) => {
    const span = element.appendChild(doc.createElement('span'));
    span.className = className;
    span.textContent = text;
  };
  part('zwf-collaboration__project', room.project);
  part('zwf-collaboration__branch', room.branch);
  if (room.folder) part('zwf-collaboration__folder', room.folder);
  element.title = `GitLab project ${room.project}, branch ${room.branch}${room.folder ? `, folder ${room.folder}` : ''}`;
  return element;
}

/**
 * Who else is in the room: a round badge per person with their initials in their color, their name as tooltip (one
 * badge per name: two tabs of one person are one), at most MAX_SHOWN and "+N" for the rest; hidden while nobody is.
 */
export class ParticipantsView {
  readonly element: HTMLElement;

  constructor(private readonly doc: Document) {
    this.element = doc.createElement('div');
    this.element.className = 'zwf-collaboration__participants';
    this.element.setAttribute('role', 'group');
    this.element.setAttribute('aria-label', 'In the room');
    this.show([]);
  }

  /** Shows `participants` in place of those before. */
  show(participants: readonly Participant[]): void {
    const users = [...new Map(participants.map(({ user }) => [user.name, user])).values()];
    const badges = users.slice(0, MAX_SHOWN).map((user) => this.#badge(initials(user.name), user.name, user.color));
    const rest = users.slice(MAX_SHOWN);
    if (rest.length > 0) badges.push(this.#badge(`+${rest.length}`, rest.map((user) => user.name).join(', ')));
    this.element.replaceChildren(...badges);
    this.element.hidden = users.length === 0;
  }

  #badge(text: string, name: string, color?: string): HTMLElement {
    const badge = this.doc.createElement('span');
    badge.className = 'zwf-collaboration__participant';
    badge.textContent = text;
    badge.title = name;
    badge.setAttribute('aria-label', name);
    if (color) badge.style.setProperty('--zwf-remote-color', color);
    return badge;
  }
}

/** The badges shown at most; the others count as "+N". */
const MAX_SHOWN = 5;
