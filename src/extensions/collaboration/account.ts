// Who is signed in to the collaboration server. See collaboration in collaboration.ts.
import { EventEmitter, type Event } from '../../core/event-emitter/event-emitter';
import { COLLABORATION_PATH } from './room-protocol';

/** Who signed in to the collaboration server (`GET /api/me`): (provider, id) identifies them. */
export interface Identity {
  readonly provider: string;
  readonly id: string;
  readonly name: string;
  readonly username?: string;
  readonly email?: string;
}

/**
 * The local user's account on a collaboration server: whether and as whom they are signed in, and the ways to sign in
 * and out. The server keeps the session in an httpOnly cookie, so the widget never holds a token: it asks the server
 * (`/api/me`) and sends the cookie along (`credentials: 'include'`, for a page on another port of the same host).
 * Signing in leaves the page: the server sends the browser to the provider and back to `returnTo`. Everything but the
 * sign-in (`/api/public/`) answers only the signed-in user, so the widget asks before it connects.
 */
export class Account {
  readonly #changed = new EventEmitter<void>();
  /** `identity` changed. */
  readonly onDidChange: Event<void> = this.#changed.event;
  readonly #base: string;
  #identity: Identity | null | undefined = undefined;

  /** The account on the server at `serverUrl` (the collaboration option `url`); `send` makes the requests (tests). */
  constructor(
    serverUrl: string,
    private readonly send: typeof fetch = (...args) => fetch(...args),
  ) {
    this.#base = serverHttpBase(serverUrl);
  }

  /** Who is signed in: null nobody, undefined not known yet (`refresh`). */
  get identity(): Identity | null | undefined {
    return this.#identity;
  }

  /** Asks the server who is signed in. Rejects when the server cannot be asked. */
  async refresh(): Promise<Identity | null> {
    const response = await this.send(`${this.#base}/api/me`, { credentials: 'include' });
    if (!response.ok && response.status !== 401) throw new Error(`${this.#base}/api/me: HTTP ${response.status}`);
    const identity = response.ok ? parseIdentity(await response.json()) : null;
    this.#set(identity);
    return identity;
  }

  /** The page that signs in at the server's provider, then comes back to `returnTo`. */
  signInUrl(returnTo: string): string {
    return `${this.#base}/api/public/auth/login?${new URLSearchParams({ return: returnTo })}`;
  }

  /** Ends the session (401: there was none). Rejects when the server cannot be asked. */
  async signOut(): Promise<void> {
    const response = await this.send(`${this.#base}/api/auth/logout`, { method: 'POST', credentials: 'include' });
    if (!response.ok && response.status !== 401) throw new Error(`${this.#base}/api/auth/logout: HTTP ${response.status}`);
    this.#set(null);
  }

  dispose(): void {
    this.#changed.dispose();
  }

  #set(identity: Identity | null): void {
    if (identity === this.#identity) return;
    this.#identity = identity;
    this.#changed.fire();
  }
}

/** The user must sign in (again) to join: signed out, or the session ended (the server refused the WebSocket). */
export class SignInRequired extends Error {
  /** What the user is told. */
  static readonly reason = 'Sign in to join this room.';

  constructor() {
    super(SignInRequired.reason);
  }
}

/** The HTTP side of the server at `url` (ws://host[/prefix]): same host and path, ws → http, wss → https. */
export function serverHttpBase(url: string): string {
  return url.replace(/^ws/, 'http').replace(/\/$/, '');
}

/** The collaboration WebSocket of the server at `url`. */
export function collaborationWebSocketUrl(url: string): string {
  return url.replace(/\/$/, '') + COLLABORATION_PATH;
}

/** `value` as an Identity, or null when it is not one (it comes from outside). */
function parseIdentity(value: unknown): Identity | null {
  const fields = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const text = (name: string) => (typeof fields[name] === 'string' && fields[name] ? (fields[name] as string) : undefined);
  const [provider, id, name, username, email] = ['provider', 'id', 'name', 'username', 'email'].map(text);
  if (provider === undefined || id === undefined) return null;
  return { provider, id, name: name ?? id, ...(username && { username }), ...(email && { email }) };
}
