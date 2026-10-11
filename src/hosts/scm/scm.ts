// The scm namespace of the extension API (VS Code's `scm`): the source controls extensions register, somewhere the
// project can be committed (the GitLab branch behind a collaboration room), for whichever extension shows them.
// Entry of hosts/scm/. See ARCHITECTURE.md, "GitLab-backed rooms".
// Why a contribution point: what commits (collaboration) and what shows committing (source-control) are two
// extensions that never know each other; both know only this registry.
import { Disposable } from '../../core/disposable/disposable';
import { EventEmitter, type Event } from '../../core/event-emitter/event-emitter';

/** The source controls as extensions use them (VS Code's `scm` namespace). */
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
  /** What it is doing. */
  readonly state: SourceControlState;
  /** `state` changed. */
  readonly onDidChange: Event<void>;
  /**
   * Commits the project's current state with `message` (VS Code: its accept-input command). `state.busy` meanwhile;
   * the source control tells the outcome itself (`window.show…Message`), as it tells its news.
   */
  commit(message: string): void;
}

export interface SourceControlState {
  /** A commit is under way (no second one meanwhile). */
  readonly busy: boolean;
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
