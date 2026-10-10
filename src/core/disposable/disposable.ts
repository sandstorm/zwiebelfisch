// Disposable: what undoes a registration or releases a subscription, in VS Code's shape. Entry of core/disposable/.
// Contribution points return one per registration; extensions push them to `context.subscriptions`.

/** A registration, subscription or resource; `dispose()` undoes or releases it (calling it again does nothing). */
export interface Disposable {
  dispose(): void;
}

export const Disposable = {
  /** A Disposable that calls `callOnDispose` once. */
  of(callOnDispose: () => void): Disposable {
    let disposed = false;
    return {
      dispose: () => {
        if (disposed) return;
        disposed = true;
        callOnDispose();
      },
    };
  },

  /** One Disposable for all of `disposables`: disposes them in reverse order (the last one made goes first). */
  from(...disposables: Disposable[]): Disposable {
    return Disposable.of(() => {
      for (const disposable of [...disposables].reverse()) disposable.dispose();
    });
  },
};
