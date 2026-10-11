// The server's small HTTP layer: requests and responses as plain values, and Node's as them. Used by the GitLab
// endpoints (gitlab/http-endpoints.ts) and the playground. See docs/architecture/server.typ.
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

const CORS = { 'Access-Control-Allow-Origin': '*' };

/** A response anyone may read (CORS `*`), plain text unless `headers` say otherwise. */
export const respond = (status: number, body: string | Uint8Array = '', headers: Record<string, string> = {}): HttpResponse => ({
  status,
  headers: { ...CORS, 'Content-Type': 'text/plain; charset=utf-8', ...headers },
  body,
});

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
