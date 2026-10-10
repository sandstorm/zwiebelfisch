import type { Document, Extension, onLoadDocumentPayload, onRequestPayload, onStatelessPayload } from '@hocuspocus/server';
import {
  DEFAULT_COMMIT_MESSAGE,
  GITLAB_ROOM_PREFIX,
  type ClientMessage,
  type ServerMessage,
} from '../../../src/features/collaboration/gitlab-protocol.ts';
import type { Authenticate, AuthenticatedUser } from '../auth.ts';
import { BlobCache } from './blob-cache.ts';
import { GitLabProject, type GitLabConfig } from './gitlab-api.ts';
import { GitLabRoom, type Author } from './gitlab-room.ts';
import { handleHttp, nodeRequest, sendResponse, type HttpRequest, type HttpResponse } from './http.ts';

export interface GitLabOptions extends GitLabConfig {
  /** The secret GitLab sends as `X-Gitlab-Token` with push webhooks (unset: no webhook endpoint). */
  webhookSecret?: string;
  /** The commit author's email when the saving user's is not known (default `typst-editor@localhost`). */
  authorEmail?: string;
}

/** The project and branch of a GitLab room name (`gitlab:<project id or path>@<branch>`), or null. */
export function parseRoomName(name: string): { project: string; branch: string } | null {
  if (!name.startsWith(GITLAB_ROOM_PREFIX)) return null;
  const rest = name.slice(GITLAB_ROOM_PREFIX.length);
  const at = rest.indexOf('@');
  if (at <= 0 || at === rest.length - 1) return null;
  return { project: rest.slice(0, at), branch: rest.slice(at + 1) };
}

interface OpenRoom {
  room: GitLabRoom;
  document: Document;
  project: string;
  branch: string;
}

/**
 * GitLab-backed rooms (`gitlab:<project>@<branch>`) for the collaboration
 * server, as a Hocuspocus extension: loads a branch into a new room, merges
 * upstream changes into a stored one, commits on a client's 'Save version'
 * (stateless `gitlab:save`), serves the rooms' other files over HTTP and
 * merges pushes reported by a GitLab webhook. Other rooms are left alone.
 *
 * Runs after the storage extension (lower priority), so a stored room is
 * loaded before it looks at it.
 */
export class GitLabExtension implements Extension {
  readonly extensionName = 'gitlab';
  readonly priority = 50;
  private readonly rooms = new Map<string, OpenRoom>();
  private readonly blobs = new BlobCache();
  private readonly options: GitLabOptions;
  private readonly authenticate: Authenticate;

  constructor(options: GitLabOptions, authenticate: Authenticate) {
    this.options = options;
    this.authenticate = authenticate;
  }

  async onLoadDocument({ documentName, document }: onLoadDocumentPayload): Promise<void> {
    const name = parseRoomName(documentName);
    if (!name) return;
    const room = new GitLabRoom(document, new GitLabProject(this.options, name.project), name.branch, this.blobs);
    await room.open();
    this.rooms.set(documentName, { room, document, ...name });
  }

  async afterUnloadDocument({ documentName }: { documentName: string }): Promise<void> {
    this.rooms.delete(documentName);
  }

  async onStateless({ documentName, payload, connection }: onStatelessPayload): Promise<void> {
    const open = this.rooms.get(documentName);
    const message = parseMessage(payload);
    if (!open || message?.type !== 'gitlab:save') return;
    const result = await open.room
      .save(this.author(message, connection.context?.user), message.message?.trim() || DEFAULT_COMMIT_MESSAGE)
      .catch((error: unknown): ServerMessage => ({ type: 'gitlab:error', message: String((error as Error)?.message ?? error) }));
    if (result.type === 'gitlab:unchanged' || result.type === 'gitlab:error') connection.sendStateless(JSON.stringify(result));
    else open.document.broadcastStateless(JSON.stringify(result));
  }

  async onRequest({ request, response }: onRequestPayload): Promise<void> {
    const result = await this.handle(nodeRequest(request));
    if (!result) return;
    sendResponse(response, result);
    // Hocuspocus' way of saying "answered": no default response, no further hooks.
    throw null;
  }

  /** The HTTP endpoints (room files, webhook) without Node's request objects; null: not ours. */
  handle(request: HttpRequest): Promise<HttpResponse | null> {
    return handleHttp(request, {
      file: async (roomName, path, token) => {
        const open = this.rooms.get(roomName);
        if (!open) return null;
        await this.authenticate(token, roomName);
        return open.room.asset(path);
      },
      webhookSecret: this.options.webhookSecret,
      push: (project, branch) => this.pushed(project, branch),
    });
  }

  /** Merges a push into the open rooms of that branch and tells their clients. */
  private async pushed(projects: string[], branch: string): Promise<void> {
    const affected = [...this.rooms.values()].filter((open) => open.branch === branch && projects.includes(open.project));
    await Promise.all(
      affected.map(async (open) => {
        const result = await open.room.pull().catch(() => null);
        if (result) open.document.broadcastStateless(JSON.stringify(result));
      }),
    );
  }

  private author(message: ClientMessage, user: AuthenticatedUser | undefined): Author {
    return {
      name: user?.name ?? message.author?.name ?? 'Typst editor',
      email: user?.email ?? message.author?.email ?? this.options.authorEmail ?? 'typst-editor@localhost',
    };
  }
}

function parseMessage(payload: string): ClientMessage | null {
  try {
    return JSON.parse(payload) as ClientMessage;
  } catch {
    return null;
  }
}
