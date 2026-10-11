// Suggestions: the completion item providers' lists in one view, each a Tiptap Suggestion plugin showing a
// SuggestWidget. See visual-editor.ts (registerCompletionItemProvider) and docs/20_extensions/03_visual-editor-constructs.typ.
import { Extension, type Editor, type Range } from '@tiptap/core';
import type { ResolvedPos } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Suggestion, type SuggestionProps } from '@tiptap/suggestion';
import type { CompletionContext, CompletionItem, CompletionItemProvider, CompletionTrigger } from '../visual-editor';
import { SuggestWidget } from './suggest-widget';

/**
 * The lists of `providers` in a view: each opens while its trigger and a query are typed in text (not in code), as
 * long as any of its items match the query (`filterCompletionItems`), and closes on Escape until another trigger is
 * typed. `context` is what the providers are asked with.
 */
export function suggestions(
  providers: readonly { readonly provider: CompletionItemProvider; readonly trigger: CompletionTrigger }[],
  context: (editor: Editor, query: string) => CompletionContext,
): Extension {
  return Extension.create({
    name: 'typstSuggestions',
    // before the keymaps and input rules: Enter, Tab, Escape and commit characters go to an open list first
    priority: 1000,
    addProseMirrorPlugins() {
      return providers.flatMap(({ provider, trigger }, index) => suggestionPlugins(this.editor, trigger, (query) => filterCompletionItems(provider.provideCompletionItems(context(this.editor, query)), query), index));
    },
  });
}

/**
 * `items` that match `query` (case ignored), best first: a label equal to it, labels starting with it, labels
 * containing it, keywords containing it; the order given within each.
 */
export function filterCompletionItems(items: readonly CompletionItem[], query: string): CompletionItem[] {
  const q = query.toLowerCase();
  const rank = (item: CompletionItem) => {
    const label = item.label.toLowerCase();
    if (label === q) return 0;
    if (label.startsWith(q)) return 1;
    if (label.includes(q)) return 2;
    return item.keywords?.some((keyword) => keyword.toLowerCase().includes(q)) ? 3 : 4;
  };
  return items
    .map((item) => ({ item, rank: rank(item) }))
    .filter(({ rank }) => rank < 4)
    .sort((a, b) => a.rank - b.rank)
    .map(({ item }) => item);
}

/** The Suggestion plugin of one provider, and one for its widget and its commit characters. */
function suggestionPlugins(editor: Editor, trigger: CompletionTrigger, items: (query: string) => CompletionItem[], index: number): Plugin[] {
  let widget: SuggestWidget | null = null;
  let props: SuggestionProps<CompletionItem, CompletionItem> | null = null;
  let unmount: (() => void) | null = null;
  const show = (next: SuggestionProps<CompletionItem, CompletionItem>) => {
    const sameQuery = props?.range.from === next.range.from && props.query === next.query;
    props = next;
    widget?.show(items(next.query), sameQuery);
  };
  const suggestion = Suggestion<CompletionItem, CompletionItem>({
    pluginKey: new PluginKey(`typstSuggestion${index}`),
    editor,
    char: trigger.char,
    findSuggestionMatch: ({ $position }) => findMatch(trigger, $position),
    allow: ({ state, range }) => !inCode(state, range.from) && items(state.doc.textBetween(range.from + trigger.char.length, range.to)).length > 0,
    // the items are asked for synchronously, while showing (no fetching): a keystroke's list is there at once
    minQueryLength: Infinity,
    dismissOnOutsideClick: false,
    decorationClass: 'typst-visual__suggestion',
    command: ({ editor, range, props: item }) => item.command({ editor, range }),
    render: () => ({
      onStart: (next) => {
        show(next);
        if (widget) unmount = next.mount(widget.element);
      },
      onUpdate: show,
      onExit: () => {
        unmount?.();
        unmount = null;
        props = null;
        widget?.hide();
      },
      onKeyDown: ({ event }) => widget?.keyDown(event) ?? false,
    }),
  });
  const accept = (item: CompletionItem) => props?.command(item);
  const widgetPlugin = new Plugin({
    view: (view) => {
      widget = new SuggestWidget(view.dom.parentElement!, view.dom, trigger.char, accept);
      return { destroy: () => widget?.dispose() };
    },
    props: {
      // a commit character typed right after the query: the chosen item, then the character
      handleTextInput: (view, from, to, text) => {
        const item = widget?.chosenItem;
        if (!props || !item?.commitCharacters?.includes(text) || from !== to || from !== props.range.to) return false;
        accept(item);
        view.dispatch(view.state.tr.insertText(text));
        return true;
      },
    },
  });
  return [suggestion, widgetPlugin];
}

/**
 * The trigger and the query right before the cursor: the trigger at the start of the text block or after one of
 * the allowed prefixes, then anything but spaces up to the cursor.
 */
function findMatch(trigger: CompletionTrigger, $position: ResolvedPos): { range: Range; query: string; text: string } | null {
  const { parent, parentOffset } = $position;
  if (!parent.isTextblock || parent.type.spec.code) return null;
  const start = Math.max(0, parentOffset - MAX_MATCH);
  const before = parent.textBetween(start, parentOffset, undefined, '\ufffc');
  const at = before.lastIndexOf(trigger.char);
  if (at < 0) return null;
  const query = before.slice(at + trigger.char.length);
  if (/[\s\ufffc]/.test(query)) return null;
  const prefixes = trigger.allowedPrefixes ?? [' ', '\u00a0'];
  if (start + at > 0 && !prefixes.includes(before[at - 1] ?? '')) return null;
  const from = $position.pos - (before.length - at);
  return { range: { from, to: $position.pos }, query, text: trigger.char + query };
}

/** How far back from the cursor a trigger is looked for. */
const MAX_MATCH = 80;

/** Whether the trigger at `pos` is in inline code (a mark whose spec says `code`). */
function inCode(state: EditorState, pos: number): boolean {
  let code = false;
  state.doc.nodesBetween(pos, pos + 1, (node) => {
    if (node.marks.some((mark) => mark.type.spec.code)) code = true;
  });
  return code;
}
