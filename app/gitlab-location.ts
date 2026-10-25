// What a GitLab address or a room name the start page's field takes points at. Used by start.ts.

/** A place in a GitLab project: the project's path, and when known the branch and the folder. */
export interface GitLabLocation {
  readonly project: string;
  readonly branch?: string;
  /** An absolute folder of the repository (`/2026/q1`); absent: the whole repository. */
  readonly folder?: string;
}

/**
 * The location `input` names, or null: a room (`gitlab:group/p@main:/2026/q1`) or a GitLab page's URL
 * (`https://gitlab.example.org/group/p`, `…/-/tree/main/2026/q1`, `…/-/blob/main/2026/q1/main.typ`: its folder). A branch
 * holding `/` cannot be told from a folder in a URL: the first part after `tree/` is the branch.
 */
export function parseGitLabLocation(input: string): GitLabLocation | null {
  const text = input.trim();
  return text.startsWith(ROOM_PREFIX) ? parseRoom(text) : parsePageUrl(text);
}

/** The room of `location`, which must have a branch. */
export function roomOf(location: GitLabLocation & { branch: string }): string {
  const folder = location.folder && location.folder !== '/' ? `:${location.folder}` : '';
  return `${ROOM_PREFIX}${location.project}@${location.branch}${folder}`;
}

/** The editor's address for a room. */
export function editorHref(room: string): string {
  return `/edit?${new URLSearchParams({ room })}`;
}

const ROOM_PREFIX = 'gitlab:';

function parseRoom(room: string): GitLabLocation | null {
  const match = /^gitlab:([^@]+)@([^:]+)(?::(\/.*))?$/.exec(room);
  if (!match) return null;
  return withFolder({ project: match[1]!, branch: match[2]! }, (match[3] ?? '').split('/').filter(Boolean));
}

function parsePageUrl(text: string): GitLabLocation | null {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const [projectPart, rest = ''] = url.pathname.split('/-/');
  const project = trimSlashes(decodeURIComponent(projectPart!));
  if (!project.includes('/')) return null;
  const [kind, branch, ...parts] = rest.split('/').filter(Boolean).map(decodeURIComponent);
  if ((kind !== 'tree' && kind !== 'blob') || !branch) return { project };
  if (kind === 'blob') parts.pop();
  return withFolder({ project, branch }, parts);
}

function withFolder(location: GitLabLocation, parts: readonly string[]): GitLabLocation {
  return parts.length ? { ...location, folder: `/${parts.join('/')}` } : location;
}

function trimSlashes(path: string): string {
  return path.replace(/^\/+|\/+$/g, '');
}
