// FakeGitLab: an in-memory GitLab REST API (repository files, commits, branches) for tests and the playground.
import { createHash } from 'node:crypto';
import { blobSha } from './blob-sha.ts';
import type { Fetch } from './gitlab-api.ts';

// An in-process GitLab for tests: one project, branches, commits with full
// snapshots, and the REST endpoints GitLabProject calls (API v4), answered
// through an injected `fetch`. No network, no ports.

interface Commit {
  sha: string;
  parent: string | null;
  files: Map<string, Uint8Array>;
  message: string;
  author: { name: string; email: string };
}

type Files = Record<string, string | Uint8Array | null>;

const encoder = new TextEncoder();
const bytes = (content: string | Uint8Array) => (typeof content === 'string' ? encoder.encode(content) : content);
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const fail = (status: number, message: string) => json({ message }, status);

export class FakeGitLab {
  readonly url = 'https://gitlab.test';
  readonly token = 'server-token';
  /** Every request as `METHOD path?query` (without the API prefix). */
  readonly requests: string[] = [];
  /** Answer the next commit request with this error (a race with a push, a server error). */
  failNextCommit: { status: number; message: string; push?: Files } | null = null;
  /** Branches nobody created yet start at `main` when first asked for (one fresh branch per e2e test). */
  autoBranches = false;
  private readonly commits = new Map<string, Commit>();
  private readonly branches = new Map<string, string>();
  private counter = 0;
  readonly project: string;

  constructor(project: string, files: Files, branch = 'main') {
    this.project = project;
    this.branches.set(branch, this.record(null, files, 'Initial commit', { name: 'Upstream', email: 'upstream@test' }).sha);
  }

  /**
   * Commits `files` (null deletes) on `branch`, as someone pushing would. A
   * branch nobody created yet starts at `main` with `autoBranches`. Returns the new sha.
   */
  push(branch: string, files: Files, message = 'Upstream change'): string {
    const parent = this.branches.get(branch) ?? (this.autoBranches ? this.branches.get('main')! : null);
    const commit = this.record(parent, files, message, { name: 'Upstream', email: 'upstream@test' });
    this.branches.set(branch, commit.sha);
    return commit.sha;
  }

  hasBranch(name: string): boolean {
    return this.branches.has(name);
  }

  head(branch: string): Commit {
    return this.commits.get(this.branches.get(branch)!)!;
  }

  /** The files of `branch` as text. */
  text(branch = 'main'): Record<string, string> {
    const decoder = new TextDecoder();
    return Object.fromEntries([...this.head(branch).files].map(([path, content]) => [path, decoder.decode(content)]));
  }

  readonly fetch: Fetch = async (url, init = {}) => {
    const headers = new Headers(init.headers);
    if (headers.get('PRIVATE-TOKEN') !== this.token) return fail(401, '401 Unauthorized');
    const prefix = `${this.url}/api/v4/projects/${encodeURIComponent(this.project)}`;
    if (!url.startsWith(prefix)) return fail(404, '404 Project Not Found');
    const target = new URL(url.slice(prefix.length), 'http://x');
    const method = init.method ?? 'GET';
    this.requests.push(`${method} ${target.pathname}${target.search}`);
    return this.route(method, target, init.body as string | undefined);
  };

  private route(method: string, url: URL, body: string | undefined): Response {
    const path = url.pathname;
    const query = url.searchParams;
    let match: RegExpMatchArray | null;
    if ((match = path.match(/^\/repository\/branches\/([^/]+)$/))) return this.branch(decodeURIComponent(match[1]));
    if (path === '/repository/tree') return this.tree(query);
    if ((match = path.match(/^\/repository\/files\/([^/]+)$/))) return this.file(decodeURIComponent(match[1]), query.get('ref')!);
    if ((match = path.match(/^\/repository\/blobs\/([0-9a-f]+)\/raw$/))) return this.blob(match[1]);
    if (path === '/repository/commits' && method === 'POST') return this.commit(JSON.parse(body ?? '{}'));
    return fail(404, '404 Not Found');
  }

  private branch(name: string): Response {
    if (!this.branches.has(name) && this.autoBranches) this.branches.set(name, this.branches.get('main')!);
    const sha = this.branches.get(name);
    return sha ? json({ name, commit: { id: sha } }) : fail(404, '404 Branch Not Found');
  }

  private resolve(ref: string): Commit | undefined {
    return this.commits.get(this.branches.get(ref) ?? ref);
  }

  private tree(query: URLSearchParams): Response {
    const commit = this.resolve(query.get('ref')!);
    if (!commit) return fail(404, '404 Tree Not Found');
    const perPage = Number(query.get('per_page') ?? 20);
    const page = Number(query.get('page') ?? 1);
    const items: { id: string; name: string; type: string; path: string }[] = [];
    const folders = new Set<string>();
    for (const [path, content] of [...commit.files].sort(([a], [b]) => a.localeCompare(b))) {
      const parts = path.slice(1).split('/');
      for (let i = 1; i < parts.length; i++) folders.add(parts.slice(0, i).join('/'));
      items.push({ id: blobSha(content), name: parts.at(-1)!, type: 'blob', path: path.slice(1) });
    }
    for (const folder of folders) items.push({ id: 'tree', name: folder, type: 'tree', path: folder });
    const slice = items.slice((page - 1) * perPage, page * perPage);
    const next = page * perPage < items.length ? String(page + 1) : '';
    return json(slice, 200, { 'x-next-page': next });
  }

  private file(path: string, ref: string): Response {
    const commit = this.resolve(ref);
    const content = commit?.files.get(`/${path}`);
    if (!commit || !content) return fail(404, '404 File Not Found');
    return json({
      file_path: path,
      encoding: 'base64',
      content: Buffer.from(content).toString('base64'),
      blob_id: blobSha(content),
      last_commit_id: this.lastCommit(commit, `/${path}`),
    });
  }

  private blob(sha: string): Response {
    for (const commit of this.commits.values()) {
      for (const content of commit.files.values()) if (blobSha(content) === sha) return new Response(content as BodyInit);
    }
    return fail(404, '404 Blob Not Found');
  }

  /** The commit that last changed `path` (up to `commit`). */
  private lastCommit(commit: Commit, path: string): string {
    let current = commit;
    for (;;) {
      const parent = current.parent ? this.commits.get(current.parent)! : null;
      const before = parent?.files.get(path);
      if (!parent || !before || blobSha(before) !== blobSha(current.files.get(path)!)) return current.sha;
      current = parent;
    }
  }

  private commit(body: { branch: string; commit_message: string; author_name: string; author_email: string; actions: GitLabAction[] }): Response {
    const failure = this.failNextCommit;
    this.failNextCommit = null;
    if (failure?.push) this.push(body.branch, failure.push);
    if (failure && failure.status !== 0) return fail(failure.status, failure.message);
    const head = this.resolve(body.branch);
    if (!head) return fail(400, 'You can only create or edit files when you are on a branch');
    const files = this.changes(head, body.actions);
    if (typeof files === 'string') return fail(400, files);
    const commit = this.record(head.sha, files, body.commit_message, { name: body.author_name, email: body.author_email });
    this.branches.set(body.branch, commit.sha);
    return json({ id: commit.sha, parent_ids: [head.sha], message: commit.message }, 201);
  }

  /** The files `actions` change (null: deleted), or why GitLab refuses them. */
  private changes(head: Commit, actions: GitLabAction[]): Files | string {
    const files: Files = {};
    for (const action of actions) {
      const problem = this.check(head, action);
      if (problem) return problem;
      let content: string | Uint8Array | null = action.encoding === 'base64' ? Buffer.from(action.content!, 'base64') : (action.content ?? null);
      if (action.action === 'move') {
        content ??= head.files.get(`/${action.previous_path}`)!;
        files[`/${action.previous_path}`] = null;
      }
      files[`/${action.file_path}`] = action.action === 'delete' ? null : content;
    }
    return files;
  }

  private check(head: Commit, action: GitLabAction): string | null {
    const path = `/${action.file_path}`;
    const existing = action.action === 'move' ? `/${action.previous_path}` : path;
    if (action.action === 'create' || action.action === 'move') {
      if (head.files.has(path)) return 'A file with this name already exists';
    }
    if (action.action === 'create') return null;
    if (!head.files.has(existing)) return "A file with this name doesn't exist";
    if (action.last_commit_id && this.lastCommit(head, existing) !== action.last_commit_id) {
      return 'You are attempting to update a file that has changed since you started editing it.';
    }
    return null;
  }

  private record(parent: string | null, changes: Files, message: string, author: Commit['author']): Commit {
    const files = new Map(parent ? this.commits.get(parent)!.files : []);
    for (const [path, content] of Object.entries(changes)) {
      if (content === null) files.delete(path);
      else files.set(path, bytes(content));
    }
    const sha = createHash('sha1').update(`commit ${++this.counter} ${parent}`).digest('hex');
    const commit = { sha, parent, files, message, author };
    this.commits.set(sha, commit);
    return commit;
  }
}

interface GitLabAction {
  action: 'create' | 'update' | 'delete' | 'move';
  file_path: string;
  previous_path?: string;
  content?: string;
  encoding?: 'text' | 'base64';
  last_commit_id?: string;
}
