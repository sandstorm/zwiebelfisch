// What the changes are shown against. See changes in changes.ts.
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import type { ProjectPath } from '../../core/paths/paths';
import type { Scm, SourceControl, SourceControlHistoryItem } from '../../hosts/scm/scm';

/**
 * The original the changes of a file are shown against: its text at the last commit (the first source control's
 * `quickDiffProvider` that has one), or, once a commit is chosen (`setCommit`), its text there (that source control's
 * `historyProvider.provideFileContent`; '' for a file not there yet). A commit's texts load on first use:
 * `original` is undefined meanwhile, and `onDidChange` fires once one has come (also when the commit is set or reset).
 *
 * Used by: the changes extension, for the Visual editor's changes and the Changes editor.
 */
export class Baseline {
  #commit: Chosen | undefined;
  /** The chosen commit's texts, by path: loaded, or undefined while loading (failed: stays so). */
  #texts = new Map<ProjectPath, string | undefined>();
  readonly #changed = new EventEmitter<void>();
  readonly onDidChange = this.#changed.event;

  constructor(private readonly scm: Scm) {}

  /** The commit chosen; undefined: the last commit. */
  get commit(): SourceControlHistoryItem | undefined {
    return this.#commit?.item;
  }

  /** Shows the changes since `item` of `control` (which has a `historyProvider`); undefined: since the last commit. */
  setCommit(control: SourceControl, item: SourceControlHistoryItem | undefined): void {
    this.#commit = item && control.historyProvider ? { control, item } : undefined;
    this.#texts = new Map();
    this.#changed.fire();
  }

  /** The text of `path` to compare with; undefined: none (no source control has it, or it is loading). */
  original(path: ProjectPath): string | undefined {
    const commit = this.#commit;
    if (!commit) return this.lastCommitted(path);
    if (!this.#texts.has(path)) this.#load(commit, path);
    return this.#texts.get(path);
  }

  /** The text of `path` at the last commit, from the first source control that has it; undefined: none has. */
  lastCommitted(path: ProjectPath): string | undefined {
    for (const control of this.scm.sourceControls) {
      const text = control.quickDiffProvider?.provideOriginalText(path);
      if (text !== undefined) return text;
    }
    return undefined;
  }

  dispose(): void {
    this.#changed.dispose();
  }

  #load(commit: Chosen, path: ProjectPath): void {
    const texts = this.#texts;
    texts.set(path, undefined);
    commit.control
      .historyProvider!.provideFileContent(commit.item.id, path)
      .then((bytes) => {
        if (texts !== this.#texts) return;
        texts.set(path, bytes ? new TextDecoder().decode(bytes) : '');
        this.#changed.fire();
      })
      .catch(() => {});
  }
}

/** A commit chosen, and the source control it is of. */
interface Chosen {
  readonly control: SourceControl;
  readonly item: SourceControlHistoryItem;
}
