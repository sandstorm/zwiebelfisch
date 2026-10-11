// The demo's ProseMirror dev tools (docs/todo/devtools.md, step 1): with `?devtools`, prosemirror-dev-tools on the
// Visual view (document tree with the projection's `src` / `sep` anchors, selection, transactions, plugin states,
// the schema in Tiptap's order). A demo-only extension built on the public API alone; not part of the library.
import { Extension } from '@tiptap/core';
import type { TypstExtension } from '../src';

/**
 * Attaches prosemirror-dev-tools to every Visual view as it is created (one panel: the view created last), through
 * a per-view Tiptap extension, whose hooks see the view's editor. The tools load only when asked for.
 */
export function devtools(): TypstExtension {
  return {
    id: 'demo.devtools',
    activate({ visualView, subscriptions }) {
      subscriptions.push(
        visualView.registerTiptapExtension(() => {
          let detach = () => {};
          let destroyed = false;
          return Extension.create({
            name: 'demoDevtools',
            onCreate() {
              void import('prosemirror-dev-tools').then(({ applyDevTools }) => {
                if (!destroyed) detach = applyDevTools(this.editor.view, {});
              });
            },
            onDestroy() {
              destroyed = true;
              detach();
            },
          });
        }),
      );
    },
  };
}
