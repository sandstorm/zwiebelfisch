// Editors: who edited a GitLab room since its last commit, how often, and since when. See gitlab-room.ts.
import type { Author } from './gitlab-room.ts';

/** The edits since a point in time: per editor (by name) who they are and how many edits, and when the first was. */
export interface EditTally {
  readonly since: number | null;
  readonly editors: ReadonlyMap<string, { readonly author: Author; readonly edits: number }>;
}

/**
 * The edits of a room not committed yet, by editor (a name; the first author seen under it): counted per change
 * of the room's Y.Doc. A commit takes the tally (`take`) and puts it back if it did not happen (`restore`), so
 * edits made while it runs stay for the next one.
 */
export class Editors {
  #since: number | null = null;
  #editors = new Map<string, { author: Author; edits: number }>();

  /** When the first edit not committed was made (null: none). */
  get since(): number | null {
    return this.#since;
  }

  /** The editors' names, in the order of their first edit. */
  get names(): string[] {
    return [...this.#editors.keys()];
  }

  /** `author` made an edit at `at` (milliseconds since the epoch). */
  edited(author: Author, at: number): void {
    this.#since ??= at;
    const editor = this.#editors.get(author.name);
    if (editor) editor.edits++;
    else this.#editors.set(author.name, { author, edits: 1 });
  }

  /** Hands over the tally and starts an empty one. */
  take(): EditTally {
    const tally = { since: this.#since, editors: this.#editors };
    this.#since = null;
    this.#editors = new Map();
    return tally;
  }

  /** Puts a taken tally back (its edits came first), together with the edits made since it was taken. */
  restore(tally: EditTally): void {
    const later = this.#editors;
    this.#since = tally.since ?? this.#since;
    this.#editors = new Map([...tally.editors].map(([name, editor]) => [name, { ...editor }]));
    for (const [name, { author, edits }] of later) {
      const editor = this.#editors.get(name);
      if (editor) editor.edits += edits;
      else this.#editors.set(name, { author, edits });
    }
  }
}
