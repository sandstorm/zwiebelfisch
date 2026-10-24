import { Disposable } from '../../core/disposable/disposable';
import { EventEmitter, type Event } from '../../core/event-emitter/event-emitter';
import type { ProjectPath } from '../../core/paths/paths';

/**
 * The places the project can be committed to (VS Code's `scm` namespace), e.g. the GitLab branch behind a room.
 *
 * Used by:
 * - extensions that can commit: they register a `SourceControl` (collaboration, for GitLab)
 * - extensions that show source controls: they list the registered ones and hear when that changes (source-control)
 * - extensions that show what changed: the originals and the history of the registered ones (changes)
 */
export interface Scm {
  /**
   * Offers `sourceControl` (VS Code's `scm.createSourceControl`) until disposed: somewhere the project can be
   * committed, shown by whichever extension shows source controls. One per `id`.
   */
  registerSourceControl(sourceControl: SourceControl): Disposable;
  /** The registered source controls, in registration order. */
  readonly sourceControls: readonly SourceControl[];
  /** A source control was registered or disposed. */
  readonly onDidChangeSourceControls: Event<void>;
}

/** Somewhere the project's state can be committed (VS Code's SourceControl), e.g. the GitLab branch behind a room. */
export interface SourceControl {
  /** Unique among the registered ones. */
  readonly id: string;
  /** Names it to people ("GitLab"). */
  readonly label: string;
  /** The commit message offered (VS Code: the input box's placeholder). */
  readonly defaultCommitMessage?: string;
  /** A commit is under way (no second one meanwhile). */
  readonly busy: boolean;
  /** The files whose changes it has not committed (VS Code: the resource states of its resource groups). */
  readonly resourceStates?: readonly SourceControlResourceState[];
  /**
   * Its save status (VS Code: `statusBarCommands`; the source-control extension shows it in the title bar), e.g. how
   * much is not committed. Clicking one commits: whoever shows source controls asks for the message, as for any commit.
   */
  readonly statusBarItems?: readonly SourceControlStatusBarItem[];
  /** The files' texts at the last commit, for showing what changed since (VS Code: its `quickDiffProvider`). */
  readonly quickDiffProvider?: QuickDiffProvider;
  /** Its commits, what each changed, and files as they were (VS Code's proposed `historyProvider`). */
  readonly historyProvider?: SourceControlHistoryProvider;
  /** `busy`, `resourceStates`, `statusBarItems` or what `quickDiffProvider` provides changed. */
  readonly onDidChange: Event<void>;
  /**
   * Commits the project's current state with `message` (VS Code: its accept-input command). `busy` meanwhile;
   * the source control tells the outcome itself (`window.show…Message`), as it tells its news. Undefined: the user
   * may not commit here (it only shows its state; VS Code: no `acceptInputCommand`).
   */
  readonly commit?: (message: string) => void;
}

/** The original of a file: its text at the last commit (VS Code's QuickDiffProvider, giving the text itself). */
export interface QuickDiffProvider {
  /** The text of `path` at the last commit: '' for a file added since; undefined: the file is not this source control's. */
  provideOriginalText(path: ProjectPath): string | undefined;
}

/**
 * The commits of a source control (VS Code's proposed SourceControlHistoryProvider): those before the current one
 * (the commit its `quickDiffProvider`'s originals are of), what each changed, and files as they were.
 */
export interface SourceControlHistoryProvider {
  /** The current commit (VS Code's `currentHistoryItemRef`); undefined: not known yet. */
  readonly currentHistoryItemRef: SourceControlHistoryItemRef | undefined;
  /**
   * The commits that changed `options.scope` (default: everything it holds), newest first, at most `options.limit` (it
   * may list fewer), from `options.cursor` on (an earlier answer's `cursor`; default: the current commit). Rejects
   * when they cannot be read.
   */
  provideHistoryItems(options: SourceControlHistoryOptions): Promise<SourceControlHistoryItems>;
  /**
   * The files that differ from commit `historyItemParentId` to commit `historyItemId`; without `historyItemParentId`,
   * those `historyItemId` changed against its first parent (a first commit: every file, added).
   */
  provideHistoryItemChanges(historyItemId: string, historyItemParentId?: string): Promise<readonly SourceControlHistoryItemChange[]>;
  /** The content of `path` at commit `historyItemId`; undefined: no such file there. */
  provideFileContent(historyItemId: string, path: ProjectPath): Promise<Uint8Array | undefined>;
  /** The current commit moved (a commit was made, or others' commits came in). */
  readonly onDidChangeCurrentHistoryItem: Event<void>;
}

export interface SourceControlHistoryOptions {
  /** Only commits that changed this file, or a file in this folder. */
  readonly scope?: { readonly kind: 'file' | 'folder'; readonly path: ProjectPath };
  readonly cursor?: string;
  readonly limit?: number;
}

/** A page of commits, and where the list goes on (undefined: no more). */
export interface SourceControlHistoryItems {
  readonly items: readonly SourceControlHistoryItem[];
  readonly cursor?: string;
}

/** A commit a name points at (VS Code's SourceControlHistoryItemRef), e.g. the current one. */
export interface SourceControlHistoryItemRef {
  readonly id: string;
  /** What points at it ("main"). */
  readonly name: string;
}

/** One commit (VS Code's SourceControlHistoryItem). */
export interface SourceControlHistoryItem {
  readonly id: string;
  readonly parentIds: readonly string[];
  /** Its message's first line. */
  readonly subject: string;
  readonly message: string;
  /** The short id shown ("3f2a91c"). */
  readonly displayId?: string;
  /** Who made it, by name. */
  readonly author?: string;
  /** Who else made it (Co-authored-by), by name. */
  readonly coAuthors?: readonly string[];
  /** When, in milliseconds since the epoch. */
  readonly timestamp?: number;
}

/** A file a commit changed (VS Code's SourceControlHistoryItemChange, by path). */
export interface SourceControlHistoryItemChange {
  readonly path: ProjectPath;
  /** Where a renamed file was. */
  readonly originalPath?: ProjectPath;
  readonly kind: 'added' | 'modified' | 'deleted' | 'renamed';
}

/** A file with changes not committed (VS Code's SourceControlResourceState). */
export interface SourceControlResourceState {
  /** The file (VS Code: `resourceUri`). A file that is gone has no row where files are listed; it still counts. */
  readonly path: ProjectPath;
  /** How side panels that list files mark it, as a file decoration: a badge ("M"), what it means, a CSS color. */
  readonly decorations?: { readonly badge?: string; readonly tooltip?: string; readonly color?: string };
}

/** A save status entry of a source control (VS Code: a `Command` of `statusBarCommands`); a click commits. */
export interface SourceControlStatusBarItem {
  readonly title: string;
  readonly tooltip?: string;
  /** `'warning'`: drawn to stand out, for what needs the user (VS Code: `statusBarItem.warningBackground`). */
  readonly backgroundColor?: 'warning';
}

/** The source controls in registration order, and word when one comes or goes. */
export class ScmHost implements Scm {
  readonly #all: SourceControl[] = [];
  readonly #changed = new EventEmitter<void>();
  readonly onDidChangeSourceControls = this.#changed.event;

  get sourceControls(): readonly SourceControl[] {
    return [...this.#all];
  }

  registerSourceControl(sourceControl: SourceControl): Disposable {
    if (this.#all.some((other) => other.id === sourceControl.id)) throw new Error(`Source control ${sourceControl.id} is registered already`);
    this.#all.push(sourceControl);
    this.#changed.fire();
    return new Disposable(() => {
      const index = this.#all.indexOf(sourceControl);
      if (index < 0) return;
      this.#all.splice(index, 1);
      this.#changed.fire();
    });
  }

  dispose(): void {
    this.#all.length = 0;
    this.#changed.dispose();
  }
}
