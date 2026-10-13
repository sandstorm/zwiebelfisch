import { Disposable } from '../disposable/disposable';
import { EventEmitter, type Event } from '../event-emitter/event-emitter';

/**
 * Whether the result of some work is still wanted (VS Code's CancellationToken).
 *
 * Some work takes a while, such as a search provider going through every file. When the user types on, its result
 * is no longer wanted. Whoever asks keeps a `CancellationTokenSource` and cancels it; the provider gets only the token
 * (`provideItems(query, token)`) and checks it between steps. We use VS Code's shape because our providers follow
 * VS Code's API (docs/40_architecture/10_conventions.typ).
 */
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
