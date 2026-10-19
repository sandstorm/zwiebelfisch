/**
 * Releases a resource once, on `dispose()` (later calls do nothing). `new Disposable(stop)` wraps a cleanup
 * function, such as a listener's removal; `Disposable.from(a, b)` disposes several in reverse order.
 *
 * Returned by every registration and listener. An extension pushes it into `context.subscriptions`, which is
 * disposed with the widget.
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
