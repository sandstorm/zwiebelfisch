// Disposable: something that holds a resource (a listener, a registration, a DOM element) until disposed. Entry of
// core/disposable/. Why VS Code's shape: extensions push everything they register into `subscriptions`, and the
// host disposes the list on destroy, so no extension needs a `destroy` of its own. See ARCHITECTURE.md, "Extensions".

/**
 * Releases a resource once, on `dispose()` (later calls do nothing). `new Disposable(stop)` wraps a cleanup
 * function, such as a listener's removal; `Disposable.from(a, b)` disposes several
 * in reverse order.
 */
export class Disposable {
  /** One disposable for several: disposes them in reverse order (the last registered goes first). */
  static from(...disposables: { dispose(): unknown }[]): Disposable {
    return new Disposable(() => {
      for (const disposable of [...disposables].reverse()) disposable.dispose();
    });
  }

  #callOnDispose: (() => unknown) | null;

  constructor(callOnDispose: () => unknown) {
    this.#callOnDispose = callOnDispose;
  }

  dispose(): void {
    const call = this.#callOnDispose;
    this.#callOnDispose = null;
    call?.();
  }
}
