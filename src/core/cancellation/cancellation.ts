// CancellationToken: tells work that may take a while (a search provider going through every file) that its result is
// not wanted any more. Entry of core/cancellation/. See docs/30_architecture/10_conventions.typ.
// Why VS Code's shape: providers are VS Code-like (`provideItems(query, token)`), and the token is what they check
// between steps; whoever asked keeps the source and cancels when the user typed on.
import { Disposable } from '../disposable/disposable';
import { EventEmitter, type Event } from '../event-emitter/event-emitter';

/** Whether the result of some work is still wanted (VS Code's CancellationToken). */
export interface CancellationToken {
  /** True once cancelled: stop and return what is there (or nothing). */
  readonly isCancellationRequested: boolean;
  /** Fires once, when cancelled; subscribing after that calls the listener at once. */
  readonly onCancellationRequested: Event<void>;
}

/** The owner's side of a token (VS Code's CancellationTokenSource): hands out `token`, cancels it. */
export class CancellationTokenSource {
  #cancelled = false;
  readonly #requested = new EventEmitter<void>();
  readonly token: CancellationToken;

  constructor() {
    const cancelled = () => this.#cancelled;
    const requested = this.#requested;
    this.token = {
      get isCancellationRequested() {
        return cancelled();
      },
      onCancellationRequested: (listener) => {
        if (!cancelled()) return requested.event(listener);
        listener();
        return new Disposable(() => {});
      },
    };
  }

  /** Cancels the token (once; later calls do nothing). */
  cancel(): void {
    if (this.#cancelled) return;
    this.#cancelled = true;
    this.#requested.fire();
    this.#requested.dispose();
  }

  /** Cancels the token and lets go of its listeners. */
  dispose(): void {
    this.cancel();
  }
}
