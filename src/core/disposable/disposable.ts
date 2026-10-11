// Disposable. Entry of core/disposable/. See docs/30_architecture/10_conventions.typ.

/**
 * Releases a resource once, on `dispose()` (later calls do nothing). `new Disposable(stop)` wraps a cleanup
 * function, such as a listener's removal; `Disposable.from(a, b)` disposes several
 * in reverse order.
 *
 * Something that holds a resource (a listener, a registration, a DOM element) until disposed. Why VS Code's shape:
 * extensions push everything they register into `subscriptions`, and the host disposes the list when the widget is
 * disposed, so no extension needs a cleanup method of its own. Everything with a lifetime (hosts, views, widgets,
 * contributed parts, the widget itself) ends with `dispose()`.
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
