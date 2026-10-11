// The check the collaboration server runs per connection. See createCollabServer in collab-server.ts.
/**
 * Decides whether a client may open a room. Resolves with what the server
 * should know about the user (it becomes the connection's `context.user`),
 * or rejects to refuse the connection.
 */
export type Authenticate = (token: string, room: string) => Promise<AuthenticatedUser>;

export interface AuthenticatedUser {
  /** Who the token belongs to, if the check knows (for logs, and the author of GitLab commits). */
  name?: string;
  /** Their email (the author email of GitLab commits). */
  email?: string;
}

/**
 * The stub check until there is a real one (GitLab sign-in, see
 * docs/40_architecture/15_development.typ, "Open work"): without `expected` every client may open every
 * room; with it, the client's token must equal it.
 */
export function sharedToken(expected: string | undefined): Authenticate {
  return async (token) => {
    if (expected !== undefined && token !== expected) throw new Error('Invalid token');
    return {};
  };
}
