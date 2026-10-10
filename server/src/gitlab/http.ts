import type { IncomingMessage, ServerResponse } from 'node:http';

/** An HTTP request, as much of it as the endpoints need. */
export interface HttpRequest {
  method: string;
  /** Path and query. */
  url: string;
  header(name: string): string | null;
  body(): Promise<string>;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string | Uint8Array;
}

export interface HttpEndpoints {
  /** The bytes of `path` in the open room `room` (null: no such room or file); rejects when `token` may not open the room. */
  file(room: string, path: string, token: string): Promise<Uint8Array | null>;
  /** The secret a webhook call must carry (unset: no webhook endpoint). */
  webhookSecret?: string;
  /** A push to `branch` of the project known by these ids (numeric id, path with namespace). */
  push(projects: string[], branch: string): Promise<void>;
}

const CORS = { 'Access-Control-Allow-Origin': '*' };

/** A response anyone may read (CORS `*`), plain text unless `headers` say otherwise. */
export const respond = (status: number, body: string | Uint8Array = '', headers: Record<string, string> = {}): HttpResponse => ({
  status,
  headers: { ...CORS, 'Content-Type': 'text/plain; charset=utf-8', ...headers },
  body,
});

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

const TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  pdf: 'application/pdf',
};

function contentType(path: string): string {
  return TYPES[path.slice(path.lastIndexOf('.') + 1).toLowerCase()] ?? 'application/octet-stream';
}

/** Node's request as an `HttpRequest`. */
export function nodeRequest(request: IncomingMessage): HttpRequest {
  return {
    method: request.method ?? 'GET',
    url: request.url ?? '/',
    header: (name) => headerValue(request.headers[name.toLowerCase()]),
    body: () => readBody(request),
  };
}

/** Writes `result` to Node's response. */
export function sendResponse(response: ServerResponse, result: HttpResponse): void {
  response.writeHead(result.status, result.headers);
  response.end(result.body);
}

function headerValue(value: string | string[] | undefined): string | null {
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

async function readBody(request: AsyncIterable<unknown>): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks).toString('utf8');
}
