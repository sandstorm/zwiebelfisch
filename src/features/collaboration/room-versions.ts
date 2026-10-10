import type * as Y from 'yjs';
import { META_MAP, type ClientMessage, type RoomMeta, type ServerMessage } from './gitlab-protocol';

/** Stateless messages to and from the server (the Hocuspocus provider's). */
export interface StatelessChannel {
  send(payload: string): void;
  /** Subscribes to messages from the server; returns the unsubscribe function. */
  listen(listener: (payload: string) => void): () => void;
}

/**
 * The versions of a room backed by a GitLab branch, as a client sees them:
 * the base (the files at the last commit, kept by the server in the room's
 * `meta` map) and "Save version", which asks the server to commit.
 */
export class RoomVersions {
  private readonly meta: Y.Map<unknown>;

  constructor(
    ydoc: Y.Doc,
    private readonly channel: StatelessChannel,
  ) {
    this.meta = ydoc.getMap(META_MAP);
  }

  /** Whether `ydoc` is the Y.Doc of a GitLab-backed room (its server put a base there). */
  static isVersioned(ydoc: Y.Doc): boolean {
    return typeof ydoc.getMap(META_MAP).get('baseSha') === 'string';
  }

  /** The text of `path` at the last commit (null: the file is new since). */
  base(path: string): string | null {
    return (this.meta.get('base') as RoomMeta['base'] | undefined)?.[path] ?? null;
  }

  /** Calls `listener` whenever the base changes (a version was saved, upstream was merged). */
  onBaseChange(listener: () => void): () => void {
    const observer = (event: Y.YMapEvent<unknown>) => {
      if (event.keysChanged.has('base')) listener();
    };
    this.meta.observe(observer);
    return () => this.meta.unobserve(observer);
  }

  /** Asks the server to commit the room's changes; the outcome arrives through `onMessage`. */
  save(message: string, author?: { name: string; email?: string }): void {
    const request: ClientMessage = { type: 'gitlab:save', message, ...(author ? { author } : {}) };
    this.channel.send(JSON.stringify(request));
  }

  /** Calls `listener` with every message of the server about versions. */
  onMessage(listener: (message: ServerMessage) => void): () => void {
    return this.channel.listen((payload) => {
      const message = parse(payload);
      if (message) listener(message);
    });
  }
}

function parse(payload: string): ServerMessage | null {
  try {
    const message = JSON.parse(payload) as ServerMessage;
    return typeof message?.type === 'string' && message.type.startsWith('gitlab:') ? message : null;
  } catch {
    return null;
  }
}
