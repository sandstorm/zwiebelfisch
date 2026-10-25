// The start page (/): the user's projects, as IntelliJ's welcome screen (docs/20_features/17_start-page.typ).
//   - signed out: "Sign in with GitLab" only
//   - signed in: a search over the GitLab projects (or a pasted GitLab URL or room), then the rooms open now, the
//     pinned ones (own and the team's) and the recent ones (api.ts: GET /api/me/rooms, followed every 10 s)
// Picking a project opens the Open dialog (open-dialog.ts); a room opens the editor (/edit?room=…).

import { api, type RoomEntry, type SignedInUser } from './api';
import { el } from './dom';
import { editorHref, type GitLabLocation, parseGitLabLocation } from './gitlab-location';
import { showOpenDialog } from './open-dialog';
import { projectSearch } from './project-search';

const ROOMS_REFRESH_MS = 10_000;

void start(document.getElementById('start')!);

async function start(root: HTMLElement): Promise<void> {
  const user = await api.me();
  if (!user) {
    root.replaceChildren(signIn());
    return;
  }
  const lists = el('div');
  root.replaceChildren(header(user), projectSearch({ onPick: (project) => void open({ project }), onLocation: (location) => void open(location) }), lists);
  const refresh = async (): Promise<void> => {
    try {
      lists.replaceChildren(...roomLists(await api.rooms(), refresh));
    } catch (error) {
      lists.replaceChildren(el('p', { className: 'error', textContent: `Your projects could not be loaded: ${(error as Error).message}` }));
    }
  };
  await refresh();
  setInterval(() => void refresh(), ROOMS_REFRESH_MS);
}

/** Opens `target` in the editor, after the Open dialog asked for what it lacks. */
async function open(target: GitLabLocation): Promise<void> {
  const room = await showOpenDialog(target);
  if (room) location.assign(editorHref(room));
}

function signIn(): HTMLElement {
  const box = el('div', { className: 'signin' });
  const button = el('button', { className: 'primary', textContent: 'Sign in with GitLab', type: 'button' });
  button.addEventListener('click', () => location.assign(`/api/public/auth/login?${new URLSearchParams({ return: '/' })}`));
  box.append(el('h1', { textContent: 'Zwiebelfisch' }), el('p', { className: 'empty', textContent: 'Typst documents in your GitLab projects, edited together.' }), button);
  return box;
}

function header(user: SignedInUser): HTMLElement {
  const signOut = el('button', { textContent: 'Sign out', type: 'button' });
  signOut.addEventListener('click', async () => {
    await api.signOut();
    location.reload();
  });
  const account = el('div');
  account.append(el('span', { className: 'meta', textContent: `${user.name} ` }), signOut);
  const bar = el('header');
  bar.append(el('h1', { textContent: 'Zwiebelfisch' }), account);
  return bar;
}

/** The sections Open now, Pinned and Recent; a section without rooms is left out, all empty says how to start. */
function roomLists(rooms: { open: RoomEntry[]; pinned: RoomEntry[]; recent: RoomEntry[] }, refresh: () => Promise<void>): HTMLElement[] {
  const sections: HTMLElement[] = [];
  const section = (title: string, entries: RoomEntry[], details: (entry: RoomEntry) => string): void => {
    if (!entries.length) return;
    const list = el('ul', { className: 'rooms' });
    list.append(...entries.map((entry) => roomItem(entry, details(entry), refresh)));
    sections.push(el('h2', { textContent: title }), list);
  };
  section('Open now', rooms.open, (entry) => `● ${entry.people.join(', ')}`);
  section('Pinned', rooms.pinned, (entry) => (entry.teamPinnedBy ? `for the team, by ${entry.teamPinnedBy}` : ago(entry.lastOpened)));
  section('Recent', rooms.recent, (entry) => ago(entry.lastOpened));
  if (!sections.length) sections.push(el('p', { className: 'empty', textContent: 'No projects yet: search for a GitLab project above, or paste its address.' }));
  return sections;
}

function roomItem(entry: RoomEntry, details: string, refresh: () => Promise<void>): HTMLElement {
  const where = parseGitLabLocation(entry.room);
  const link = el('a', { href: editorHref(entry.room), title: entry.room });
  if (where) {
    link.append(where.project, el('span', { className: 'where', textContent: ` · ${where.branch}${where.folder ? ` · ${where.folder}` : ''}` }));
  } else link.textContent = entry.room;
  const meta = el('span', { className: entry.people.length ? 'meta live' : 'meta', textContent: details });
  const act = (label: string, title: string, pressed: boolean | null, action: () => Promise<void>): HTMLButtonElement => {
    const button = el('button', { type: 'button', textContent: label, title });
    if (pressed !== null) button.setAttribute('aria-pressed', String(pressed));
    button.addEventListener('click', async () => {
      try {
        await action();
      } catch (error) {
        alert((error as Error).message);
      }
      await refresh();
    });
    return button;
  };
  const item = el('li');
  item.append(
    link,
    meta,
    act('📌', entry.pinned ? 'Unpin' : 'Pin', entry.pinned, () => api.pin(entry.room, !entry.pinned)),
    act('👥', entry.teamPinnedBy ? 'Unpin for the team' : 'Pin for the team (Maintainers)', !!entry.teamPinnedBy, () => api.teamPin(entry.room, !entry.teamPinnedBy)),
  );
  if (entry.lastOpened) item.append(act('✕', 'Remove from recent', null, () => api.forget(entry.room)));
  return item;
}

/** "2 h ago", "yesterday", … for a time in ms; empty without one. */
function ago(time: number | undefined): string {
  if (!time) return '';
  const minutes = Math.round((Date.now() - time) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}
