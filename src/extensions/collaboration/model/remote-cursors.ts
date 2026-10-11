// RemoteCursors: other users' carets and selections over Yjs awareness, reported as presences.
// See model.ts.
import type { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { ProjectPath } from '../../../core/paths/paths';
import { SourceOffset, type SourceRange } from '../../../core/typst-document/typst-document';
import type { User } from '../../../core/user/user';
import type { PlacedPresence } from '../presence/presence';

/**
 * Presence: publishes the local user's selection through y-protocols
 * awareness, and reports the other users' places, in every file, through
 * `onPresence` (only when they changed). Positions travel as Y relative
 * positions, so they stay on their characters while anyone edits; they are
 * resolved again after every change of the shared texts and every presence
 * update (once per microtask, after the views have taken the change).
 */
export class RemoteCursors {
  private scheduled = false;
  private destroyed = false;
  /** What `onPresence` was last told (as JSON), so unchanged places are not reported again. */
  private reported = '[]';

  constructor(
    private readonly awareness: Awareness,
    private readonly options: RemoteCursorsOptions,
  ) {
    const { name, color } = options.user;
    awareness.setLocalStateField('user', { name, color: color ?? colorFor(name) });
    awareness.on('change', this.schedule);
    awareness.doc.on('update', this.schedule);
    // the others already there
    this.schedule();
  }

  /** Whether another client is in the room (with a cursor or without). */
  get hasOthers(): boolean {
    return [...this.awareness.getStates().keys()].some((client) => client !== this.awareness.clientID);
  }

  /** Publishes where the local user is: a source range in `path`, or nowhere (null). */
  setLocal(path: ProjectPath | null, range?: SourceRange): void {
    const text = path && range ? this.options.text(path) : undefined;
    if (!path || !range || !text) {
      this.awareness.setLocalStateField('cursor', null);
      return;
    }
    const position = (index: number) => Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(text, index));
    const cursor: CursorState = { path, anchor: position(range.from), head: position(range.to) };
    this.awareness.setLocalStateField('cursor', cursor);
  }

  dispose(): void {
    this.destroyed = true;
    this.awareness.off('change', this.schedule);
    this.awareness.doc.off('update', this.schedule);
    this.awareness.setLocalStateField('cursor', null);
    if (this.reported !== '[]') this.options.onPresence?.([]);
  }

  private readonly schedule = (): void => {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      if (!this.destroyed) this.report();
    });
  };

  /** Tells `onPresence` the others' places, if they changed. */
  private report(): void {
    const everyone = this.others();
    const json = JSON.stringify(everyone);
    if (json === this.reported) return;
    this.reported = json;
    this.options.onPresence?.(everyone);
  }

  /** The other users' places, in every file they are in. */
  private others(): PlacedPresence[] {
    const result: PlacedPresence[] = [];
    this.awareness.getStates().forEach((state, client) => {
      const presence = client === this.awareness.clientID ? null : this.placeOf(String(client), state);
      if (presence) result.push(presence);
    });
    return result;
  }

  /** One user's place, if they are in a shared file. */
  private placeOf(id: string, state: Record<string, unknown>): PlacedPresence | null {
    const place = this.cursorPlace(state.cursor as CursorState | null | undefined);
    if (!place) return null;
    const user = state.user as User | undefined;
    const name = user?.name ?? '';
    return { id, user: { name, color: user?.color ?? colorFor(name) }, ...place };
  }

  /** Where another client's cursor is: null when its file is no shared one (any more), or its positions are gone. */
  private cursorPlace(cursor: CursorState | null | undefined): { path: ProjectPath; anchor: SourceOffset; head: SourceOffset } | null {
    const path = cursor ? ProjectPath.parse(cursor.path) : null;
    const text = path ? this.options.text(path) : undefined;
    if (!cursor || !path || !text) return null;
    const anchor = this.resolve(cursor.anchor, text);
    const head = this.resolve(cursor.head, text);
    return anchor === null || head === null ? null : { path, anchor, head };
  }

  private resolve(json: unknown, text: Y.Text): SourceOffset | null {
    const absolute = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(json), text.doc!);
    return absolute?.type === text ? SourceOffset.of(absolute.index) : null;
  }
}

export interface RemoteCursorsOptions {
  user: User;
  /** The shared text of `path` (where cursors are anchored). */
  text(path: ProjectPath): Y.Text | undefined;
  /** Called with every other user's place, in any file, whenever one changes (the views, the file panel). */
  onPresence?(presences: readonly PlacedPresence[]): void;
}

/** A stable color for a user without one. */
function colorFor(name: string): string {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

const PALETTE = ['#d33682', '#2aa198', '#6c71c4', '#cb4b16', '#268bd2', '#859900', '#b58900', '#dc322f'];

/** What a client publishes in its awareness state (field `cursor`; `user` follows the y-codemirror convention). */
interface CursorState {
  /** A project path, as another client sent it: parsed before use. */
  path: string;
  anchor: unknown;
  head: unknown;
}
