// RoomVersions: "Save version" and upstream changes in GitLab-backed rooms, over stateless messages.
// See collaboration.ts.
import type * as Y from 'yjs';
import { META_MAP, type ClientMessage, type ServerMessage } from './gitlab-protocol';

/** Stateless messages to and from the server (the Hocuspocus provider's). */
export interface StatelessChannel {
  send(payload: string): void;
  /** Subscribes to messages from the server; returns the unsubscribe function. */
  listen(listener: (payload: string) => void): () => void;
}

/**
 * The versions of a room backed by a GitLab branch, as a client sees them:
 * "Save version", which asks the server to commit, and the server's answers.
 */
export class RoomVersions {
  constructor(private readonly channel: StatelessChannel) {}

  /** Whether `ydoc` is the Y.Doc of a GitLab-backed room (its server put the last commit's sha there). */
  static isVersioned(ydoc: Y.Doc): boolean {
    return typeof ydoc.getMap(META_MAP).get('baseSha') === 'string';
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
