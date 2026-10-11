// The GitLab rooms' HTTP endpoints next to the WebSocket: room files and push webhooks. See GitLabExtension in gitlab-extension.ts.
import { respond, type HttpRequest, type HttpResponse } from '../http.ts';

export interface HttpEndpoints {
  /** The bytes of `path` in the open room `room` (null: no such room or file); rejects when `token` may not open the room. */
  file(room: string, path: string, token: string): Promise<Uint8Array | null>;
  /** The secret a webhook call must carry (unset: no webhook endpoint). */
  webhookSecret?: string;
  /** A push to `branch` of the project known by these ids (numeric id, path with namespace). */
  push(projects: string[], branch: string): Promise<void>;
}

/**
 * The server's HTTP endpoints next to the WebSocket:
 *
 * - `GET /rooms/<room>/files/<path>`: a file of an open room (images, data),
 *   with the room's token as `Authorization: Bearer <token>`. Blob bytes are
 *   cached by sha.
 * - `POST /gitlab/webhook`: GitLab push events (`X-Gitlab-Token` must be the
 *   configured secret); merges the push into the open rooms of that branch.
 *
 * Resolves with null for every other request.
 */
export async function handleHttp(request: HttpRequest, endpoints: HttpEndpoints): Promise<HttpResponse | null> {
  const url = new URL(request.url, 'http://server');
  const file = url.pathname.match(/^\/rooms\/([^/]+)\/files(\/.+)$/);
  if (file) return roomFile(request, decodeURIComponent(file[1]), decodeURIComponent(file[2]), endpoints);
  if (url.pathname === '/gitlab/webhook' && endpoints.webhookSecret) return webhook(request, endpoints);
  return null;
}

async function roomFile(request: HttpRequest, room: string, path: string, endpoints: HttpEndpoints): Promise<HttpResponse> {
  if (request.method === 'OPTIONS') {
    return respond(204, '', { 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Allow-Headers': 'Authorization' });
  }
  if (request.method !== 'GET') return respond(405, 'Method not allowed');
  const token = request.header('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  let content: Uint8Array | null;
  try {
    content = await endpoints.file(room, path, token);
  } catch {
    return respond(401, 'Unauthorized');
  }
  if (!content) return respond(404, 'Not found');
  return respond(200, content, { 'Content-Type': contentType(path), 'Cache-Control': 'private, no-cache' });
}

function contentType(path: string): string {
  return TYPES[path.slice(path.lastIndexOf('.') + 1).toLowerCase()] ?? 'application/octet-stream';
}

const TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  pdf: 'application/pdf',
};

async function webhook(request: HttpRequest, endpoints: HttpEndpoints): Promise<HttpResponse> {
  if (request.method !== 'POST') return respond(405, 'Method not allowed');
  if (request.header('x-gitlab-token') !== endpoints.webhookSecret) return respond(401, 'Unauthorized');
  let event: PushEvent;
  try {
    event = JSON.parse(await request.body());
  } catch {
    return respond(400, 'Invalid JSON');
  }
  const push = pushTarget(event);
  if (!push) return respond(202, 'Ignored');
  await endpoints.push(push.projects, push.branch);
  return respond(202, 'Accepted');
}

interface PushEvent {
  object_kind?: string;
  ref?: string;
  project_id?: number;
  project?: { id?: number; path_with_namespace?: string };
}

/** The project (by id and by path) and branch a push event is about; null for other events and tag pushes. */
function pushTarget(event: PushEvent): { projects: string[]; branch: string } | null {
  if (event.object_kind !== 'push' || !event.ref?.startsWith('refs/heads/')) return null;
  const projects = [event.project_id ?? event.project?.id, event.project?.path_with_namespace].filter((id) => id !== undefined).map(String);
  return { projects, branch: event.ref.slice('refs/heads/'.length) };
}
