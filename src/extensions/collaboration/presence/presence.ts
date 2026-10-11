// Presence. See ../collaboration.ts.
import { EventEmitter, type Event } from '../../../core/event-emitter/event-emitter';
import type { ProjectPath } from '../../../core/paths/paths';
import type { SourceOffset, TypstDocument } from '../../../core/typst-document/typst-document';
import type { User } from '../../../core/user/user';

/**
 * Another user's place in a text: their caret (`head`) and selection (`anchor`..`head`, empty for a plain caret),
 * as offsets in the text an editor shows (a file's, or a raw box's code). `id` tells users apart (two may share a name).
 *
 * Other users' carets and selections as source ranges, and where the editors read them (`Presences`). Pure (no Yjs, no
 * DOM): the eager part of the extension uses it, so it is not in the lazily loaded chunk (model/).
 */
export interface Presence {
  id: string;
  user: PresenceUser;
  anchor: number;
  head: number;
}

/** Who another user is, as the editors show them: with the CSS color of their caret, selection and markers. */
export type PresenceUser = Required<User>;

/** A presence in a file: its offsets are in the file's text. */
export interface PlacedPresence extends Presence {
  path: ProjectPath;
  anchor: SourceOffset;
  head: SourceOffset;
}

/** Where the other users are, as the contributions that draw them read it. */
export interface PresenceSource {
  /** The others' places in `document` now (offsets in its current text); none when it is no project file. */
  presencesIn(document: TypstDocument): readonly PlacedPresence[];
  /** The others' places in the file `path` now. */
  presencesAt(path: ProjectPath): readonly PlacedPresence[];
  /** Fires whenever someone's place changes, in any file. */
  readonly onDidChange: Event<void>;
}

/** Everyone's places as last reported (`set`), for the editors of every document and the file panel. */
export class Presences implements PresenceSource {
  #all: readonly PlacedPresence[] = [];
  readonly #changed = new EventEmitter<void>();
  readonly onDidChange = this.#changed.event;

  /** `pathOf`: where a document is in the project now (it may be renamed). */
  constructor(private readonly pathOf: (document: TypstDocument) => ProjectPath | undefined) {}

  /** Replaces everyone's places, in every file. */
  set(all: readonly PlacedPresence[]): void {
    this.#all = all;
    this.#changed.fire();
  }

  presencesIn(document: TypstDocument): readonly PlacedPresence[] {
    const path = this.pathOf(document);
    return path ? this.presencesAt(path) : [];
  }

  presencesAt(path: ProjectPath): readonly PlacedPresence[] {
    return this.#all.filter((presence) => presence.path === path);
  }

  dispose(): void {
    this.#changed.dispose();
  }
}

/** Up to two initials of a name, for small markers ("Ann Lee" → "AL"). */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  return words
    .slice(0, 2)
    .map((word) => String.fromCodePoint(word.codePointAt(0)!).toUpperCase())
    .join('');
}
