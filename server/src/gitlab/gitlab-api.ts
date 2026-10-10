// GitLabProject: the GitLab REST calls a room needs (tree, blobs, commits). See gitlab-extension.ts.
/** A `fetch` (injected, so tests can answer in-process). */
export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface GitLabConfig {
  /** The GitLab instance, e.g. `https://gitlab.com`. */
  url: string;
  /** A token with `api` scope for the projects the rooms edit (server-side; never sent to clients). */
  token: string;
  fetch?: Fetch;
}

/** A file of the repository (absolute project path, `/chapter.typ`) and its blob. */
export interface TreeEntry {
  path: string;
  sha: string;
}

export interface RepositoryFile {
  content: Uint8Array;
  /** The commit that last changed the file (up to the ref it was read at). */
  lastCommitId: string;
}

export type CommitAction =
  | { action: 'create' | 'update'; path: string; content: string | Uint8Array; lastCommitId?: string }
  | { action: 'move'; path: string; previousPath: string; content?: string | Uint8Array; lastCommitId?: string }
  | { action: 'delete'; path: string; lastCommitId?: string };

export interface CommitRequest {
  branch: string;
  message: string;
  author: { name: string; email: string };
  actions: CommitAction[];
}

export class GitLabError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * The few GitLab REST calls (API v4) a room needs, for one project. Hidden:
 * URLs and their encoding, authentication, pagination, base64.
 */
export class GitLabProject {
  private readonly fetch: Fetch;
  private readonly api: string;
  private readonly token: string;

  constructor(config: GitLabConfig, project: string) {
    this.token = config.token;
    this.fetch = config.fetch ?? ((url, init) => globalThis.fetch(url, init));
    this.api = `${config.url.replace(/\/$/, '')}/api/v4/projects/${encodeURIComponent(project)}`;
  }

  /** The commit `branch` points at. */
  async head(branch: string): Promise<string> {
    const body = (await this.json(`/repository/branches/${encodeURIComponent(branch)}`)) as { commit: { id: string } };
    return body.commit.id;
  }

  /** Every file (blob) of the tree at `ref`, all pages. */
  async tree(ref: string): Promise<TreeEntry[]> {
    const entries: TreeEntry[] = [];
    for (let page: string | null = '1'; page; ) {
      const response = await this.request(`/repository/tree?ref=${encodeURIComponent(ref)}&recursive=true&per_page=100&page=${page}`);
      const items = (await response.json()) as { type: string; path: string; id: string }[];
      for (const item of items) if (item.type === 'blob') entries.push({ path: `/${item.path}`, sha: item.id });
      page = response.headers.get('x-next-page') || null;
    }
    return entries;
  }

  /** One file at `ref`, with the commit that last changed it. */
  async file(path: string, ref: string): Promise<RepositoryFile> {
    const body = (await this.json(`/repository/files/${encodeURIComponent(path.slice(1))}?ref=${encodeURIComponent(ref)}`)) as {
      content: string;
      last_commit_id: string;
    };
    return { content: Buffer.from(body.content, 'base64'), lastCommitId: body.last_commit_id };
  }

  /** The bytes of a blob. */
  async blob(sha: string): Promise<Uint8Array> {
    const response = await this.request(`/repository/blobs/${encodeURIComponent(sha)}/raw`);
    return new Uint8Array(await response.arrayBuffer());
  }

  /** Creates one commit on `branch`; resolves with its sha and its parent. */
  async commit(request: CommitRequest): Promise<{ sha: string; parent: string | null }> {
    const body = {
      branch: request.branch,
      commit_message: request.message,
      author_name: request.author.name,
      author_email: request.author.email,
      actions: request.actions.map(toGitLabAction),
    };
    const response = await this.request('/repository/commits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const commit = (await response.json()) as { id: string; parent_ids?: string[] };
    return { sha: commit.id, parent: commit.parent_ids?.[0] ?? null };
  }

  private async json(path: string): Promise<unknown> {
    return (await this.request(path)).json();
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = { ...(init.headers as Record<string, string>), 'PRIVATE-TOKEN': this.token };
    const response = await this.fetch(this.api + path, { ...init, headers });
    if (!response.ok) throw new GitLabError(response.status, await errorMessage(response));
    return response;
  }
}

function toGitLabAction(action: CommitAction): Record<string, string> {
  const result: Record<string, string> = { action: action.action, file_path: action.path.slice(1) };
  if (action.action === 'move') result.previous_path = action.previousPath.slice(1);
  if (action.action !== 'delete' && action.content !== undefined) {
    const text = typeof action.content === 'string';
    result.content = text ? (action.content as string) : Buffer.from(action.content).toString('base64');
    result.encoding = text ? 'text' : 'base64';
  }
  if (action.lastCommitId) result.last_commit_id = action.lastCommitId;
  return result;
}

async function errorMessage(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const body = JSON.parse(text) as { message?: unknown; error?: unknown };
    return String(body.message ?? body.error ?? text);
  } catch {
    return text || response.statusText;
  }
}
