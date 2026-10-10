/**
 * Decides whether a client may open a room. Resolves with what the server
 * should know about the user (it becomes the connection's `context.user`),
 * or rejects to refuse the connection.
 */
export type Authenticate = (token: string, room: string) => Promise<AuthenticatedUser>;

export interface AuthenticatedUser {
  /** Who the token belongs to, if the check knows (for logs and, later, commit authors). */
  name?: string;
}

/**
 * The stub check until there is a real one (GitLab, see
 * docs/todo/server-gitlab.md): without `expected` every client may open every
 * room; with it, the client's token must equal it.
 */
export function sharedToken(expected: string | undefined): Authenticate {
  return async (token) => {
    if (expected !== undefined && token !== expected) throw new Error('Invalid token');
    return {};
  };
}
