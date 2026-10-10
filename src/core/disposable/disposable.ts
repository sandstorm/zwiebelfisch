// Disposable: what a registration or subscription returns, in VS Code's terms. Entry of core/disposable/.
// Why a class of its own: every contribution point (`register…`) and event (`onDid…`) returns one, so
// whoever registers can undo it the same way, and a list of them can be disposed in one go.

/**
 * Undoes a registration or subscription: `dispose()` removes what was registered.
 * Disposing twice does nothing.
 */
export class Disposable {
  private callOnDispose: (() => void) | null;

  constructor(callOnDispose: () => void) {
    this.callOnDispose = callOnDispose;
  }

  dispose(): void {
    const call = this.callOnDispose;
    this.callOnDispose = null;
    call?.();
  }
}
