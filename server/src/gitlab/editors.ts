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

  /** `author` made an edit at `at` (milliseconds since the epoch); null: someone unknown (counted in `since` only). */
  edited(author: Author | null, at: number): void {
    this.#since ??= at;
    if (!author) return;
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

/** How many paths a generated commit message names; it counts the others. */
const NAMED_PATHS = 3;

/**
 * The author and message of a commit the server makes by itself: by whoever made the most edits (the first of them
 * on a tie; `fallback` when nobody is known), "Edits by Ann, Bob: chapters/intro.typ, results.typ" (at most three
 * paths named), the other editors as co-authors.
 */
export function automaticCommit(edits: EditTally, paths: readonly string[], fallback: Author): { author: Author; message: string } {
  let author = fallback;
  let most = -1;
  for (const editor of edits.editors.values()) {
    if (editor.edits > most) [author, most] = [editor.author, editor.edits];
  }
  const names = [...edits.editors.keys()];
  const shown = paths.slice(0, NAMED_PATHS).map((path) => path.replace(/^\//, ''));
  const more = paths.length > NAMED_PATHS ? ` and ${paths.length - NAMED_PATHS} more` : '';
  const subject = `${names.length ? `Edits by ${names.join(', ')}` : 'Edits'}: ${shown.join(', ')}${more}`;
  return { author, message: withCoAuthors(subject, edits, author) };
}

/** `message` with a `Co-authored-by:` trailer for every editor of `edits` but `author` (the convention GitLab shows). */
export function withCoAuthors(message: string, edits: EditTally, author: Author): string {
  const others = [...edits.editors.values()].filter((editor) => editor.author.name !== author.name);
  if (!others.length) return message;
  return `${message}\n\n${others.map(({ author: { name, email } }) => `Co-authored-by: ${name} <${email}>`).join('\n')}`;
}
