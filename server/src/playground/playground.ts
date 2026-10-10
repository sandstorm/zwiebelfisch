import { randomUUID } from 'node:crypto';
import type { Extension, onRequestPayload } from '@hocuspocus/server';
import type { CollabOptions } from '../collab-server.ts';
import type { FakeGitLab } from '../gitlab/fake-gitlab.ts';
import { parseRoomName, type GitLabExtension } from '../gitlab/gitlab-extension.ts';
import { nodeRequest, respond, sendResponse, type HttpRequest, type HttpResponse } from '../gitlab/http.ts';

// The demo playground (`mise run demo`): GitLab rooms against an in-memory
// fake GitLab, plus dev-only HTTP endpoints the playground bar calls. Never
// part of a real deployment (server/src/main.ts does not load this file).

/** The fake repository's project path; the demo's GitLab mode opens `PLAYGROUND_ROOM`. */
export const PLAYGROUND_PROJECT = 'demo/report';
export const PLAYGROUND_ROOM = `gitlab:${PLAYGROUND_PROJECT}@main`;

/** What a simulated upstream commit does: add a paragraph, or revise the first heading (to provoke a conflict). */
export type UpstreamChange = 'append' | 'heading';

/** Handles a request the way the GitLab extension does (here: its push webhook). */
type Deliver = (request: HttpRequest) => Promise<HttpResponse | null>;

/**
 * The collaboration server's options for the playground: GitLab rooms backed
 * by `gitlab` (with a webhook, so simulated pushes merge right away) and the
 * playground endpoints. Plain rooms work as on every server. `appendTo` is the
 * file simulated upstream commits change.
 */
export function playgroundOptions(gitlab: FakeGitLab, options: { appendTo: string }): CollabOptions {
  const webhookSecret = randomUUID();
  return {
    gitlab: { url: gitlab.url, token: gitlab.token, fetch: gitlab.fetch, webhookSecret },
    extensions: [new PlaygroundEndpoints(gitlab, { appendTo: options.appendTo, webhookSecret })],
  };
}

/**
 * Dev-only HTTP endpoints (CORS `*`, so the demo on another port may call them):
 *
 * - `GET /playground`: `{ project, room }`; tells the demo that this server
 *   has the fake GitLab, and which room is its repository.
 * - `POST /playground/upstream?room=gitlab:<project>@<branch>[&change=append|heading]`:
 *   commits a change to that branch of the fake repository, as a colleague
 *   pushing would, then delivers GitLab's push webhook, so the open room
 *   merges it (or reports a conflict). Answers `{ sha, path, message }`.
 */
export class PlaygroundEndpoints implements Extension {
  readonly extensionName = 'playground';
  private commits = 0;
  private readonly gitlab: FakeGitLab;
  private readonly options: { appendTo: string; webhookSecret: string };

  constructor(gitlab: FakeGitLab, options: { appendTo: string; webhookSecret: string }) {
    this.gitlab = gitlab;
    this.options = options;
  }

  async onRequest({ request, response, instance }: onRequestPayload): Promise<void> {
    const extension = instance.configuration.extensions.find((e) => e.extensionName === 'gitlab') as GitLabExtension | undefined;
    const result = await this.handle(nodeRequest(request), async (hook) => (extension ? extension.handle(hook) : null));
    if (!result) return;
    sendResponse(response, result);
    // Hocuspocus' way of saying "answered": no default response, no further hooks.
    throw null;
  }

  /** The endpoints without Node's request objects; `deliver` receives the webhook call. Null: not ours. */
  async handle(request: HttpRequest, deliver: Deliver): Promise<HttpResponse | null> {
    const url = new URL(request.url, 'http://server');
    if (url.pathname === '/playground') {
      return request.method === 'GET' ? json({ project: PLAYGROUND_PROJECT, room: PLAYGROUND_ROOM }) : respond(405, 'Method not allowed');
    }
    if (url.pathname === '/playground/upstream') {
      return request.method === 'POST' ? this.upstream(url.searchParams, deliver) : respond(405, 'Method not allowed');
    }
    return null;
  }

  private async upstream(query: URLSearchParams, deliver: Deliver): Promise<HttpResponse> {
    const target = parseRoomName(query.get('room') ?? '');
    if (!target) return respond(400, 'room must be a GitLab room: gitlab:<project>@<branch>');
    if (target.project !== this.gitlab.project) return respond(404, `The fake GitLab has only the project ${this.gitlab.project}`);
    const change: UpstreamChange = query.get('change') === 'heading' ? 'heading' : 'append';
    const n = ++this.commits;
    const path = this.options.appendTo;
    const current = this.gitlab.text(this.gitlab.hasBranch(target.branch) ? target.branch : 'main')[path] ?? '';
    const message = `${change === 'heading' ? 'Revise a heading' : 'Add a paragraph'} (simulated upstream commit ${n})`;
    const sha = this.gitlab.push(target.branch, { [path]: upstreamEdit(current, change, n) }, message);
    await deliver(pushWebhook(target.project, target.branch, this.options.webhookSecret));
    return json({ sha, path, message });
  }
}

/** `text` after the `n`-th simulated upstream change. */
export function upstreamEdit(text: string, change: UpstreamChange, n: number): string {
  const heading = /^(=+ [^\n<]*?)(\s*<[^>\n]+>)?$/m;
  if (change === 'heading' && heading.test(text)) return text.replace(heading, `$1 (upstream revision ${n})$2`);
  const paragraph = `Upstream edit ${n}: a colleague added this paragraph on GitLab.\n`;
  return `${text.replace(/\n*$/, '')}\n\n${paragraph}`;
}

/** The request GitLab sends to the push webhook. */
function pushWebhook(project: string, branch: string, secret: string): HttpRequest {
  const event = { object_kind: 'push', ref: `refs/heads/${branch}`, project: { path_with_namespace: project } };
  return {
    method: 'POST',
    url: '/gitlab/webhook',
    header: (name) => (name === 'x-gitlab-token' ? secret : null),
    body: async () => JSON.stringify(event),
  };
}

const json = (body: unknown): HttpResponse => respond(200, JSON.stringify(body), { 'Content-Type': 'application/json' });
