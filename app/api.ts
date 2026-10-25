// The server's endpoints the start page uses (docs/30_configuration/05_deployment.typ), on this page's origin with
// the session cookie.

/** Who is signed in (GET /api/me). */
export interface SignedInUser {
  readonly id: string;
  readonly name: string;
  readonly username?: string;
}

/** A room the start page lists. */
export interface RoomEntry {
  readonly room: string;
  /** When the user last opened it (ms); absent for a room they never opened (a team pin, one open now). */
  readonly lastOpened?: number;
  readonly pinned: boolean;
  /** Who pinned it for the team; absent: no team pin. */
  readonly teamPinnedBy?: string;
  /** Who is in it now. */
  readonly people: readonly string[];
}

export interface Rooms {
  readonly open: RoomEntry[];
  readonly pinned: RoomEntry[];
  readonly recent: RoomEntry[];
}

/** A GitLab project the user may edit. */
export interface Project {
  readonly path: string;
  readonly name: string;
  readonly description?: string;
}

export interface Branches {
  readonly default: string;
  readonly branches: readonly string[];
}

/** A template: the folder whose files a new project starts with. */
export interface Template {
  readonly name: string;
  /** Its folder (`/_templates/report`). */
  readonly path: string;
  /** The folder it serves: itself and every folder below (`/` for the repository's). */
  readonly scope: string;
}

/** The projects (folders with a main.typ) and templates of a branch. */
export interface Folders {
  readonly folders: readonly string[];
  readonly templates: readonly Template[];
}

export const api = {
  /** The signed-in user, or null. */
  async me(): Promise<SignedInUser | null> {
    const response = await fetch('/api/me', { credentials: 'include' });
    if (response.status === 401) return null;
    return (await ok(response)).json();
  },
  async signOut(): Promise<void> {
    await ok(await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }));
  },
  async rooms(): Promise<Rooms> {
    return json('/api/me/rooms');
  },
  async pin(room: string, pinned: boolean): Promise<void> {
    await send(`/api/me/rooms/${encodeURIComponent(room)}/pin`, pinned ? 'PUT' : 'DELETE');
  },
  async teamPin(room: string, pinned: boolean): Promise<void> {
    await send(`/api/rooms/${encodeURIComponent(room)}/team-pin`, pinned ? 'PUT' : 'DELETE');
  },
  /** Off the recent list. */
  async forget(room: string): Promise<void> {
    await send(`/api/me/rooms/${encodeURIComponent(room)}`, 'DELETE');
  },
  async projects(search: string, signal?: AbortSignal): Promise<Project[]> {
    return json(`/api/gitlab/projects?${new URLSearchParams({ search })}`, signal);
  },
  async branches(project: string, search = ''): Promise<Branches> {
    return json(`${projectPath(project)}/branches?${new URLSearchParams({ search })}`);
  },
  async folders(project: string, ref: string): Promise<Folders> {
    return json(`${projectPath(project)}/folders?${new URLSearchParams({ ref })}`);
  },
  /** Opens a new project folder `path` from `template` (its path; "" for the built-in one); answers its room. */
  async createFolder(project: string, ref: string, path: string, template: string): Promise<string> {
    const response = await send(`${projectPath(project)}/folders`, 'POST', { ref, path, template });
    return ((await response.json()) as { room: string }).room;
  },
};

function projectPath(project: string): string {
  return `/api/gitlab/projects/${encodeURIComponent(project)}`;
}

async function json<T>(url: string, signal?: AbortSignal): Promise<T> {
  return (await ok(await fetch(url, { credentials: 'include', signal }))).json();
}

async function send(url: string, method: string, body?: unknown): Promise<Response> {
  return ok(
    await fetch(url, {
      method,
      credentials: 'include',
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    }),
  );
}

/** `response`, or an error with the server's words. */
async function ok(response: Response): Promise<Response> {
  if (!response.ok) throw new Error((await response.text()).trim() || `HTTP ${response.status}`);
  return response;
}
