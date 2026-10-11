// StyleSheets: the widget's CSS in the root node it renders into (the page's <head>, or the shadow root of a
// <typst-editor>). See registerStyleSheet in ../workbench.ts.
import { Disposable } from '../../../core/disposable/disposable';

/**
 * Puts stylesheets where the widget on `host` renders: into its shadow root when `host` lives in one, else into the
 * document's `<head>`. Widgets in the same root share each distinct stylesheet (one `<style>`, in the order first
 * added); it is removed when the last registration of it is disposed. Attach `host` before adding.
 */
export class StyleSheets {
  constructor(private readonly host: HTMLElement) {}

  /** Adds `css` (as a `<style>`, with `id` if given) until the result is disposed. */
  add(css: string, id?: string): Disposable {
    const root = this.host.getRootNode();
    const target = root instanceof ShadowRoot ? root : this.host.ownerDocument.head;
    const sheets = ROOTS.get(target) ?? new Map<string, Held>();
    ROOTS.set(target, sheets);
    let held = sheets.get(css);
    if (!held) {
      const element = this.host.ownerDocument.createElement('style');
      if (id) element.id = id;
      element.textContent = css;
      target.append(element);
      held = { element, users: 0 };
      sheets.set(css, held);
    }
    held.users++;
    const shared = held;
    return new Disposable(() => {
      if (--shared.users > 0) return;
      shared.element.remove();
      sheets.delete(css);
    });
  }
}

/** Per root node: the `<style>` elements by their text, shared by every widget (and extension) in that root. */
const ROOTS = new WeakMap<Node, Map<string, Held>>();

/** A `<style>` in a root and how many registrations hold it. */
interface Held {
  readonly element: HTMLStyleElement;
  users: number;
}
