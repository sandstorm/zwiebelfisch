import { Disposable } from '../../core/disposable/disposable';
import { EventEmitter, type Event } from '../../core/event-emitter/event-emitter';
import type { ProjectPath } from '../../core/paths/paths';

/**
 * The places the project can be committed to (VS Code's `scm` namespace), e.g. the GitLab branch behind a room.
 *
 * Used by:
 * - extensions that can commit: they register a `SourceControl` (collaboration, for GitLab)
 * - extensions that show source controls: they list the registered ones and hear when that changes (source-control)
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
   * What it shows in the status bar (VS Code: `statusBarCommands`), e.g. how much is not committed. Clicking one
   * commits: whoever shows source controls asks for the message, as for any commit.
   */
  readonly statusBarItems?: readonly SourceControlStatusBarItem[];
  /** The files' texts at the last commit, for showing what changed since (VS Code: its `quickDiffProvider`). */
  readonly quickDiffProvider?: QuickDiffProvider;
  /** `busy`, `resourceStates`, `statusBarItems` or what `quickDiffProvider` provides changed. */
  readonly onDidChange: Event<void>;
  /**
   * Commits the project's current state with `message` (VS Code: its accept-input command). `busy` meanwhile;
   * the source control tells the outcome itself (`window.show…Message`), as it tells its news.
   */
  commit(message: string): void;
}

/** The original of a file: its text at the last commit (VS Code's QuickDiffProvider, giving the text itself). */
export interface QuickDiffProvider {
  /** The text of `path` at the last commit: '' for a file added since; undefined: the file is not this source control's. */
  provideOriginalText(path: ProjectPath): string | undefined;
}

/** A file with changes not committed (VS Code's SourceControlResourceState). */
export interface SourceControlResourceState {
  /** The file (VS Code: `resourceUri`). A file that is gone has no row where files are listed; it still counts. */
  readonly path: ProjectPath;
  /** How side panels that list files mark it, as a file decoration: a badge ("M"), what it means, a CSS color. */
  readonly decorations?: { readonly badge?: string; readonly tooltip?: string; readonly color?: string };
}

/** A status bar entry of a source control (VS Code: a `Command` of `statusBarCommands`); a click commits. */
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
