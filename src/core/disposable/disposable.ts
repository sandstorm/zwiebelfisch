/**
 * Releases a resource once, on `dispose()` (later calls do nothing). `new Disposable(stop)` wraps a cleanup
 * function, such as a listener's removal; `Disposable.from(a, b)` disposes several in reverse order.
 *
 * Every registration, listener or DOM element someone adds must be removed again. VS Code's answer: each one returns
 * a Disposable, and an extension pushes it into `context.subscriptions`. When the widget is disposed, the host disposes
 * that list, so no extension needs a cleanup method of its own. Everything with a lifetime (hosts, editors, `Project`,
 * the widget) ends with `dispose()` (docs/40_architecture/10_conventions.typ, "Extension API").
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
