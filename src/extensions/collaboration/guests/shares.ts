// A room's guest links on the server. See Guests in guests.ts.
import { EventEmitter, type Event } from '../../../core/event-emitter/event-emitter';
import { serverHttpBase } from '../account';
import { roomSharesPath, type Share } from '../room-protocol';

/**
 * The guest links of one room, as the server answers them (with the session cookie): to a member every active one,
 * to a guest their own. `refresh` asks again (on `guests:changed`); `onDidChange` fires with every answer.
 */
export class Shares {
  readonly #changed = new EventEmitter<void>();
  /** `shares` changed. */
  readonly onDidChange: Event<void> = this.#changed.event;
  readonly #url: string;
  #shares: readonly Share[] = [];

  /** The links of `room` on the server at `serverUrl`; `send` makes the requests (tests). */
  constructor(
    serverUrl: string,
    room: string,
    private readonly send: typeof fetch = (...args) => fetch(...args),
  ) {
    this.#url = serverHttpBase(serverUrl) + roomSharesPath(room);
  }

  /** The active links, the earliest expiry first. */
  get shares(): readonly Share[] {
    return this.#shares;
  }

  /** Asks the server again; a refusal or a server that cannot be asked leaves none. */
  async refresh(): Promise<void> {
    let shares: Share[] = [];
    try {
      const response = await this.send(this.#url, { credentials: 'include', cache: 'no-store' });
      if (response.ok) shares = parseShares(await response.json());
    } catch {
      // none known
    }
    this.#shares = shares;
    this.#changed.fire();
  }

  /** Makes a link for `label` lasting `days`: the share with its secret (`token`). Rejects with the server's reason. */
  async create(label: string, days: number): Promise<Share & { token: string }> {
    const response = await this.send(this.#url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label, days }),
    });
    if (!response.ok) throw new Error(await reason(response));
    const [share] = parseShares({ shares: [await response.json()] });
    if (!share?.token) throw new Error('The server sent no link.');
    void this.refresh();
    return share as Share & { token: string };
  }

  /** Revokes the link `id`: its guests lose access at once. Rejects with the server's reason. */
  async revoke(id: string): Promise<void> {
    const response = await this.send(`${this.#url}/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'include' });
    if (!response.ok) throw new Error(await reason(response));
    void this.refresh();
  }

  dispose(): void {
    this.#changed.dispose();
  }
}

async function reason(response: Response): Promise<string> {
  return (await response.text()).trim() || `HTTP ${response.status}`;
}

/** The shares in `value` (`{ shares: [...] }`), those that are not dropped (it comes from outside). */
function parseShares(value: unknown): Share[] {
  const list = (value as { shares?: unknown } | null)?.shares;
  if (!Array.isArray(list)) return [];
  return list.flatMap((item: Partial<Share>): Share[] => {
    if (typeof item?.label !== 'string' || typeof item.sharedBy !== 'string' || typeof item.expiresAt !== 'number') return [];
    const share: Share = { label: item.label, sharedBy: item.sharedBy, createdAt: typeof item.createdAt === 'number' ? item.createdAt : 0, expiresAt: item.expiresAt };
    if (typeof item.id === 'string') share.id = item.id;
    if (Array.isArray(item.online)) share.online = item.online.filter((name) => typeof name === 'string');
    if (typeof item.token === 'string') share.token = item.token;
    return [share];
  });
}
