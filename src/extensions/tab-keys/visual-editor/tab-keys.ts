// The tab-keys extension's Tiptap extension; see tabKeys in ../tab-keys.ts.
import { Extension } from '@tiptap/core';
import { Plugin, type EditorState, type PluginView, type Transaction } from '@tiptap/pm/state';

/**
 * Tab and Shift+Tab stay in the text.
 *
 * - In code (a code block, or a textblock whose spec says `code`) they indent and outdent the selected lines, also in a
 *   list item or a table cell.
 * - Elsewhere the constructs' keymaps use them (lists nest, tables move between cells); what none takes is consumed
 *   instead of moving the focus out of the editor.
 * - Escape, then Tab or Shift+Tab, moves the focus on as the browser does, once (no keyboard trap). Escape in a raw box
 *   counts too.
 */
export const TabKeys = Extension.create({
  name: 'typstTabKeys',
  priority: 1, // the lowest Tiptap honours: 0 counts as the default, 100
  addExtensions() {
    return [CodeIndentation];
  },
  addKeyboardShortcuts() {
    return { Tab: () => true, 'Shift-Tab': () => true };
  },
  addProseMirrorPlugins() {
    return [new Plugin({ view: (view) => escapeThenTab(view.dom) })];
  },
});

/** Tab and Shift+Tab in code: before the constructs' keymaps (lists, tables, task lists at 100 to 120). */
const CodeIndentation = Extension.create({
  name: 'typstCodeIndentation',
  priority: 200,
  addKeyboardShortcuts() {
    const run = (indent: (tr: Transaction, lineStart: number, line: string) => void) => () => {
      const tr = indentLines(this.editor.state, indent);
      if (tr) this.editor.view.dispatch(tr.scrollIntoView());
      return tr !== null;
    };
    return {
      Tab: run((tr, lineStart) => tr.insertText(INDENT_UNIT, tr.mapping.map(lineStart))),
      'Shift-Tab': run((tr, lineStart, line) => {
        const spaces = /^ */.exec(line)![0].length;
        const start = tr.mapping.map(lineStart);
        // back to the indent unit's column before: 4 spaces to 2, 3 to 2, 1 to 0
        if (spaces > 0) tr.delete(start, start + (spaces % INDENT_UNIT.length || INDENT_UNIT.length));
      }),
    };
  },
});

/** The indentation Tab adds in code: two spaces, Typst's style and the Source editor's (CodeMirror's default). */
const INDENT_UNIT = '  ';

/**
 * `indent` applied to every line the selection touches in the code it is in (a caret: its line), or null where the
 * selection is not within one code textblock. A selection ending right at a line's start leaves that line, as in
 * CodeMirror.
 */
function indentLines(state: EditorState, indent: (tr: Transaction, lineStart: number, line: string) => void): Transaction | null {
  const { $from, $to } = state.selection;
  const code = $from.parent;
  if (!code.type.spec.code || !$from.sameParent($to)) return null;
  const start = $from.start();
  const text = code.textContent;
  const [from, to] = [$from.pos - start, $to.pos - start];
  const tr = state.tr;
  for (let lineStart = text.lastIndexOf('\n', from - 1) + 1; ; ) {
    const end = text.indexOf('\n', lineStart);
    indent(tr, start + lineStart, text.slice(lineStart, end < 0 ? text.length : end));
    if (end < 0 || end + 1 >= to) return tr;
    lineStart = end + 1;
  }
}

/**
 * Lets the Tab after an Escape in `dom` (the editor's, raw boxes included) through to the browser: caught before
 * any handler inside (capture phase), so neither a keymap nor a raw box's code editor consumes it. The browser moves
 * the focus from a focus stop just outside `dom` (after it; before it for Shift+Tab), so it leaves the editor rather
 * than going on to what is focusable inside (a raw box's code, a code block's language).
 */
function escapeThenTab(dom: HTMLElement): PluginView {
  let escaped = false;
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Tab' && escaped) {
      event.stopImmediatePropagation();
      focusOutside(dom, event.shiftKey ? 'before' : 'after');
    }
    if (!MODIFIERS.has(event.key)) escaped = event.key === 'Escape';
  };
  dom.addEventListener('keydown', onKeyDown, true);
  return { destroy: () => dom.removeEventListener('keydown', onKeyDown, true) };
}

/**
 * Focuses a stop (out of the tab order itself) right `side` of `dom`, gone once the focus moves on: the browser's Tab
 * then goes on from there.
 */
function focusOutside(dom: HTMLElement, side: 'before' | 'after'): void {
  const stop = dom.ownerDocument.createElement('span');
  stop.tabIndex = -1;
  stop.addEventListener('blur', () => stop.remove(), { once: true });
  dom[side](stop);
  stop.focus({ preventScroll: true });
}

/** Keys pressed on their way to a combination (Shift for Shift+Tab): they keep an Escape's effect. */
const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta']);
