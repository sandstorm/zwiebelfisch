import type {
  beforeUnloadDocumentPayload,
  Document,
  Extension,
  onAwarenessUpdatePayload,
  onLoadDocumentPayload,
  onRequestPayload,
  onStatelessPayload,
} from '@hocuspocus/server';
import {
  DEFAULT_COMMIT_MESSAGE,
  GITLAB_ROOM_PREFIX,
  type ClientMessage,
} from '../../../src/core/room-protocol/room-protocol.ts';
import type { Authenticate, AuthenticatedUser } from '../auth.ts';
import { BlobCache } from './blob-cache.ts';
import { GitLabProject, type GitLabConfig } from './gitlab-api.ts';
import { GitLabRoom, type Author } from './gitlab-room.ts';
import { nodeRequest, sendResponse, type HttpRequest, type HttpResponse } from '../http.ts';
import { handleHttp } from './http-endpoints.ts';

/**
 * GitLab-backed rooms (`gitlab:<project id or path>@<branch>`) for the collaboration server, as a Hocuspocus
 * extension. Other rooms are left alone.
 *
 * Such a room is a branch that people edit together in the browser and commit back to GitLab. This class is the glue
 * between Hocuspocus and the rooms: it opens a `GitLabRoom` per loaded Y.Doc, passes on a client's save (stateless
 * `gitlab:save`), tells a room when its last user left, answers the HTTP endpoints (room files, GitLab's push
 * webhook) and finds out who made an edit. The room itself does the repository work (load, commit, merge). The
 * server config holds the only GitLab token; clients never see it.
 *
 * Runs after the storage extension (lower priority), so a stored room is loaded before it looks at it.
 * See docs/30_architecture/09_server.typ, "GitLab rooms".
 */
export class GitLabExtension implements Extension {
  readonly extensionName = 'gitlab';
  readonly priority = 50;
  private readonly rooms = new Map<string, OpenRoom>();
  private readonly blobs = new BlobCache();
  private readonly options: GitLabOptions;
  private readonly authenticate: Authenticate;
  /** The name each connection's client goes by in the room's awareness (`user.name`), by connection context. */
  private readonly awarenessNames = new WeakMap<object, string>();

  constructor(options: GitLabOptions, authenticate: Authenticate) {
    this.options = options;
    this.authenticate = authenticate;
  }

  async onLoadDocument({ documentName, document }: onLoadDocumentPayload): Promise<void> {
    const name = parseRoomName(documentName);
    if (!name) return;
    const room = new GitLabRoom(document, new GitLabProject(this.options, name.project), name.branch, {
      blobs: this.blobs,
      editorOf: (origin) => this.editorOf(origin),
      authorEmail: this.authorEmail(),
      autoCommit: this.options.autoCommit === false ? null : (this.options.autoCommit ?? DEFAULT_AUTO_COMMIT),
      broadcast: (message) => document.broadcastStateless(JSON.stringify(message)),
    });
    await room.open();
    this.rooms.set(documentName, { room, document, ...name });
  }

  /** The last user left: the room commits by itself first (after a while, unless someone is back). */
  async beforeUnloadDocument({ documentName, document }: beforeUnloadDocumentPayload): Promise<void> {
    await this.rooms.get(documentName)?.room.left(() => document.getConnectionsCount() === 0);
  }

  async afterUnloadDocument({ documentName }: { documentName: string }): Promise<void> {
    this.rooms.get(documentName)?.room.dispose();
    this.rooms.delete(documentName);
  }

  /** Remembers the name a connection's client publishes in the awareness (`user.name`), the name of its edits. */
  async onAwarenessUpdate({ connection, added, updated, awareness }: onAwarenessUpdatePayload): Promise<void> {
    if (!connection?.context) return;
    for (const id of [...added, ...updated]) {
      const name = (awareness.getStates().get(id) as { user?: { name?: unknown } } | undefined)?.user?.name;
      if (typeof name === 'string' && name.trim()) this.awarenessNames.set(connection.context, name.trim());
    }
  }

  async onStateless({ documentName, payload, connection }: onStatelessPayload): Promise<void> {
    const open = this.rooms.get(documentName);
    const message = parseMessage(payload);
    if (!open || message?.type !== 'gitlab:save') return;
    const result = await open.room.save(this.author(message, connection.context?.user), message.message?.trim() || DEFAULT_COMMIT_MESSAGE);
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
      email: user?.email ?? message.author?.email ?? this.authorEmail(),
    };
  }

  /**
   * Who made a change, by its Hocuspocus transaction origin: a client's connection, or a server-side direct
   * connection. The name the connection authenticated with, else the one its client publishes in the awareness;
   * null when neither is known.
   */
  private editorOf(origin: unknown): Author | null {
    const context = contextOf(origin);
    const user = context?.user as AuthenticatedUser | undefined;
    const name = user?.name ?? (context && this.awarenessNames.get(context));
    return name ? { name, email: user?.email ?? this.authorEmail() } : null;
  }

  private authorEmail(): string {
    return this.options.authorEmail ?? DEFAULT_AUTHOR_EMAIL;
  }
}

export interface GitLabOptions extends GitLabConfig {
  /** The secret GitLab sends as `X-Gitlab-Token` with push webhooks (unset: no webhook endpoint). */
  webhookSecret?: string;
  /** The commit author's email when the saving user's is not known (default `typst-editor@localhost`). */
  authorEmail?: string;
  /**
   * Minutes without edits after which a room commits its changes by itself (also 20 s after the last user left);
   * `false`: never, only "Save to GitLab…". Default 10.
   */
  autoCommit?: number | false;
}

/**
 * The `autoCommit` option from its environment variable (`TYPST_GITLAB_AUTO_COMMIT`): `off` (or `false`, `0`), or
 * minutes (fractions allowed); unset or empty: the default. Throws on anything else.
 */
export function parseAutoCommit(value: string | undefined): number | false | undefined {
  const text = value?.trim().toLowerCase();
  if (!text) return undefined;
  if (text === 'off' || text === 'false' || text === '0') return false;
  const minutes = Number(text);
  if (!Number.isFinite(minutes) || minutes <= 0) throw new Error(`TYPST_GITLAB_AUTO_COMMIT: "off" or minutes, not "${value}"`);
  return minutes;
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

const DEFAULT_AUTO_COMMIT = 10;

function parseMessage(payload: string): ClientMessage | null {
  try {
    return JSON.parse(payload) as ClientMessage;
  } catch {
    return null;
  }
}

/** The connection context of a Hocuspocus transaction origin (`{ source: 'connection', connection }` or `{ source: 'local', context }`). */
function contextOf(origin: unknown): Record<string, unknown> | undefined {
  const value = origin as { source?: unknown; connection?: { context?: unknown }; context?: unknown } | null;
  const context = value?.source === 'connection' ? value.connection?.context : value?.source === 'local' ? value.context : undefined;
  return typeof context === 'object' && context !== null ? (context as Record<string, unknown>) : undefined;
}

const DEFAULT_AUTHOR_EMAIL = 'typst-editor@localhost';
