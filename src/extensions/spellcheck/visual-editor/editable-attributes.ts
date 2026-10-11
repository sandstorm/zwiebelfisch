// The spellcheck attributes on a Visual editor's editable element. See spellcheck in ../spellcheck.ts.
import { Extension, type AnyExtension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { SpellcheckAttributes } from '../spellcheck';

/**
 * A Tiptap extension putting what `read` returns on the editor's editable element (ProseMirror's `attributes` prop,
 * merged with the host's). While its view lives, `refreshes` holds a function that reads them again and shows them
 * if they changed.
 */
export function editableAttributes(read: () => SpellcheckAttributes, refreshes: Set<() => void>): AnyExtension {
  return Extension.create({
    name: 'spellcheckAttributes',
    addProseMirrorPlugins() {
      return [
        new Plugin<SpellcheckAttributes>({
          key,
          state: { init: read, apply: (tr, value) => tr.getMeta(key) ?? value },
          props: {
            attributes: (state) => {
              const { spellcheck, lang } = key.getState(state)!;
              return { spellcheck: String(spellcheck), ...(lang ? { lang } : {}) };
            },
          },
          view: (view) => {
            const refresh = () => {
              const next = read();
              const shown = key.getState(view.state)!;
              if (next.spellcheck === shown.spellcheck && next.lang === shown.lang) return;
              view.dispatch(view.state.tr.setMeta(key, next).setMeta('addToHistory', false));
            };
            refreshes.add(refresh);
            return { destroy: () => refreshes.delete(refresh) };
          },
        }),
      ];
    },
  });
}

const key = new PluginKey<SpellcheckAttributes>('spellcheckAttributes');
