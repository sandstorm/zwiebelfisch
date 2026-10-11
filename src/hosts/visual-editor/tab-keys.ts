// See VisualEditor in ./visual-editor.ts.
import { Extension } from '@tiptap/core';
import { Plugin, type PluginView } from '@tiptap/pm/state';

/**
 * Tab and Shift+Tab stay in the text. The constructs' keymaps use them first (lists nest, tables move between cells,
 * code blocks indent); what none of them takes is consumed here, last (priority 1), instead of moving the focus out
 * of the editor. The way out by keyboard, as in CodeMirror (no keyboard trap): Escape, then Tab or Shift+Tab moves
 * the focus on as the browser does, once. Escape in a raw box counts too.
 */
export const TabKeys = Extension.create({
  name: 'typstTabKeys',
  priority: 1, // the lowest Tiptap honours: 0 counts as the default, 100
  addKeyboardShortcuts() {
    return { Tab: () => true, 'Shift-Tab': () => true };
  },
  addProseMirrorPlugins() {
    return [new Plugin({ view: (view) => escapeThenTab(view.dom) })];
  },
});

/**
 * Lets the Tab after an Escape in `dom` (the editor's, raw boxes included) through to the browser: caught before
 * any handler inside (capture phase), so neither a keymap nor a raw box's code editor consumes it.
 */
function escapeThenTab(dom: HTMLElement): PluginView {
  let escaped = false;
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Tab' && escaped) event.stopImmediatePropagation();
    if (!MODIFIERS.has(event.key)) escaped = event.key === 'Escape';
  };
  dom.addEventListener('keydown', onKeyDown, true);
  return { destroy: () => dom.removeEventListener('keydown', onKeyDown, true) };
}

/** Keys pressed on their way to a combination (Shift for Shift+Tab): they keep an Escape's effect. */
const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta']);
