= Visual editor constructs <architecture-visual-editor-constructs>

The Visual editor models a Typst construct only when an extension contributes it; *anything else shows as raw Typst in a box*. The built-in constructs (headings, lists, tables, images, figures, …) use the same API.

- `context.visualEditor.registerNode(spec)`: a block or inline node (`TypstNodeSpec`).
- `context.visualEditor.registerMark(spec)`: inline formatting (`TypstMarkSpec`).
- *Experimental:* the shapes may change between versions.

How the conversion between Typst and #link("https://prosemirror.net/")[ProseMirror] works: @architecture-prosemirror-typst.

== The spec <architecture-visual-editor-constructs-spec>

A spec groups its fields by owner:

```ts
{
  name: 'callout',
  // Node.create(..): schema, attributes, node view, commands, keymap, priority; given to Tiptap untouched
  tiptap: Callout,
  typst: {
    // which Typst it reads (ProseMirror's parseDOM, for Typst)
    parseTypst: {
      syntaxNodes: { Heading: { block, standsAlone, takesLabel }, Strong: { inline } }, // by Lezer node name
      calls: { callout: { block }, link: { inline, inRunningText } }, // by function name ('*': any other)
    },
    // how an edited node is written back (ProseMirror's toDOM, for Typst)
    toTypst,
    labelled, anchors, container, atomToTypst, escapeAfter, onDidChange,
  },
  // what the Visual editor does for its nodes (nodes only)
  view: { box, title, tools, keepsDom, ownsPseudoElements },
}
```
#table(
  columns: 3,
  [Field], [Whose], [What],
  [`name`, `typst`, `view`], [ours], [The Typst side and the Visual editor's handling],
  [`tiptap`, its `priority` and attributes], [#link("https://tiptap.dev/")[Tiptap]], [The node or mark type; omit it when another spec of the same name defines it],
  [`parseTypst.syntaxNodes` keys], [Lezer + codemirror-lang-typst 0.6.0], [`Heading`, `ListItem`, `Raw`, `Strong`, `Ref`, `FuncCall`],
  [`parseTypst.calls` keys, `toTypst` output], [the Typst language], [Function names, Typst source],
)

=== The node <architecture-visual-editor-constructs-node>

- *Attributes:* the Tiptap extension declares every attribute it needs, `rendered: false` for the ones that keep its source: `sep` (whitespace to the next block), `src` (an atom's Typst), and its own (the callout's `layout`).
- *`labelled`:* the node gets a `label` attribute for a label (`<tip>`) after the block.
- *Tiptap `priority`* (default 100, higher first) orders the schema, mark nesting, keymaps, plugins and parse rules.
- *Same name twice:* the later spec extends the earlier one (another `toTypst`, more parse rules).

=== Reading Typst <architecture-visual-editor-constructs-parse>

- *Parse functions* get the `TypstParseContext` and the Lezer node, and return a node or `null`. `null` lets the next spec try; with no taker the source stays raw.
- *Return `null` for anything you cannot write back exactly.*
- *Order:* the spec with the higher Tiptap priority is asked first (task lists, 110, before bullet lists).
- *`block(p, node, sep)`* reads a block, *`inline(p, node, marks)`* a node or `PlacedNode[]` in running text.
- *`standsAlone`:* a block even without blank lines around it (`Heading`, `ListItem`). *`takesLabel`:* a label right after it is its label.
- *`inRunningText(p, call)`:* the call belongs in running text even where `inline` leaves it raw.

`TypstParseContext`: `schema`, `source`, `text(range)`, `blocks(contentBlock)`, `itemBlocks(body)`, `inline(nodes, marks?)`, `blockCall(call)`, `isOneParagraph(nodes)`, `textblock(…)`, `unchangedNode(type, attrs, content?)`, `raw(src, marks?)`, `serial()`.

Read calls with the package's plain functions over Lezer nodes:

#table(
  columns: 2,
  [Function], [Returns],
  [`calleeName(call, source)`], [The called function's name; `''` for `table.header(..)`],
  [`callArguments(call)`], [The arguments in the parentheses (`Named` for `key: value`)],
  [`namedArgument(call, name, source)`], [The value of `name: …`, or `null`],
  [`trailingContent(call)`], [The content blocks `[..]` after the parentheses; `null` if not closed],
  [`hasOnlyArguments(call)`], [Whether it is `name(..)` with no content block],
  [`withHash(node)`], [The node's `SourceRange` with its `#`],
  [`children(node)`], [The node's children],
  [`isClosedContent(node)`], [Whether it is a closed content block],
  [`decodeString(literal)`], [A string literal's value; `null` for escapes other than `\"` and `\\`],
  [`quote(text)`], [A string literal of `text`],
)

=== Writing Typst <architecture-visual-editor-constructs-serialize>

- *Only edited nodes* are written; the rest keeps its source.
- *`toTypst(state, node, pos, parent)`* writes through the `TypstSerializeState`: `hidden(src)`, `shown(src, kind, from, to)`, `blocks(node, start, sep)`, `block`, `textblock`, `inline`, `item`, `closing(src)`, `after(src)`, `indented(print, by?)`, `endBlock`.
- *Without `toTypst`:* textblocks write their inline content, block atoms their `src`, inline atoms `atomToTypst(node)`.
- *`anchors`:* attributes a fresh parse updates in place, as `src` and `sep`.
- *`container(item)`:* consecutive nodes of this type form a container of the returned type (list items, their list).
- *`onDidChange`:* what the spec reads changed (a style declared); the Visual editors parse again.
- *Marks:* `toTypst(mark, around)` returns `{ open, close }` (`*…*`, or `#strong[…]` where delimiters would not work).

=== Node groups <architecture-visual-editor-constructs-groups>

Constructs meet through Tiptap node groups, without naming each other:

- `figureBody`: what a figure may hold (images and tables: `group: 'block figureBody'`).
- `blockContainer`: holds blocks an alignment may wrap (table cells).

== Example: a callout <architecture-visual-editor-constructs-callout>

`#callout(title: "Tip")[…]` as a box with its title in a field and its content as editable text, plus "Callout" in the Insert menu. Editing the title rewrites only the call's head; a call it does not model (`#callout(kind: "x")[…]`) stays raw Typst. Tested in `src/index.visual-editor-construct.test.ts`.

```ts
import type { SyntaxNode } from '@lezer/common';
import { Node } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import {
  callArguments, createTypstEditor, decodeString, namedArgument, quote, trailingContent, withHash,
  type ToolbarItem, type TypstExtension, type TypstNodeSpec, type TypstParseContext, type TypstSerializeState,
} from 'typst-editor';

/** How a callout's source lies around its blocks (`#callout(title: "Tip")[` and `]`), and the title written there. */
interface CalloutLayout {
  open: string;
  close: string;
  title: string;
}

/** The node: blocks in a box whose title is a field of its own. */
const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  // `sep` (the whitespace after the callout's source) and `layout` (how it was written) keep its source: never rendered
  addAttributes: () => ({ title: { default: 'Note', rendered: false }, sep: { default: null, rendered: false }, layout: { default: null, rendered: false } }),
  renderHTML: () => ['aside', { class: 'callout' }, ['div', 0]],
  addNodeView: () => ({ node, getPos, editor }) => {
    const doc = editor.view.dom.ownerDocument;
    const dom = doc.createElement('aside');
    dom.className = 'callout';
    const header = dom.appendChild(doc.createElement('div'));
    header.contentEditable = 'false';
    const title = header.appendChild(doc.createElement('input'));
    title.setAttribute('aria-label', 'Callout title');
    title.value = node.attrs.title;
    title.addEventListener('change', () => {
      const pos = getPos();
      if (pos !== undefined) editor.view.dispatch(editor.state.tr.setNodeAttribute(pos, 'title', title.value));
    });
    const contentDOM = dom.appendChild(doc.createElement('div'));
    return {
      dom,
      contentDOM,
      update: (next: ProseMirrorNode) => {
        if (next.type !== node.type) return false;
        if (title.value !== next.attrs.title) title.value = next.attrs.title;
        return true;
      },
      // the field is the box's, not the text's
      stopEvent: (event: Event) => header.contains(event.target as globalThis.Node),
      ignoreMutation: (mutation: { target: globalThis.Node }) => header.contains(mutation.target),
    };
  },
});

/** `#callout[..]` or `#callout(title: "plain string")[..]`, whose content is blocks; anything else stays raw Typst. */
function parseCallout(p: TypstParseContext, call: SyntaxNode, sep: string | null): ProseMirrorNode | null {
  const content = trailingContent(call);
  const title = calloutTitle(p, call);
  if (content?.length !== 1 || title === null) return null;
  const { content: blocks, from, to } = p.blocks(content[0]);
  const source = withHash(call);
  const layout: CalloutLayout = { open: p.text({ from: source.from, to: from }), close: p.text({ from: to, to: source.to }), title };
  return p.schema.nodes.callout.create({ title, sep, layout }, blocks);
}

/** The title of `(title: "…")` (no arguments: "Note"); null for other arguments. */
function calloutTitle(p: TypstParseContext, call: SyntaxNode): string | null {
  const args = callArguments(call);
  const title = namedArgument(call, 'title', p.source);
  if (args.length === 0) return 'Note';
  return args.length === 1 && title?.name === 'Str' ? decodeString(p.text(title)) : null;
}

/** As written while the title is; a new callout, or one with a changed title, gets the call written anew. */
function calloutToTypst(state: TypstSerializeState, callout: ProseMirrorNode, pos: number): void {
  const layout: CalloutLayout | null = callout.attrs.layout;
  const title: string = callout.attrs.title;
  state.hidden(layout?.title === title ? layout.open : `#callout(title: ${quote(title)})[`);
  state.blocks(callout, pos + 1, '\n\n');
  state.closing(layout?.close ?? ']');
}

const CALLOUT: TypstNodeSpec = {
  name: 'callout',
  tiptap: Callout,
  typst: { parseTypst: { calls: { callout: { block: parseCallout } } }, toTypst: calloutToTypst, anchors: ['layout'], labelled: true },
};

/** "Callout" in the Insert menu: the selected blocks into a callout. */
const INSERT_CALLOUT: ToolbarItem = {
  group: 'insert',
  order: 80,
  action: { label: 'Callout', icon: '<svg viewBox="0 0 24 24" width="18" height="18"><rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor"/></svg>', run: (c) => c.wrapIn('callout') },
};

const CSS = '.callout { border-left: 3px solid var(--te-accent); padding: 4px 12px; } .callout input { font-weight: 600; border: none; }';

export function callout(): TypstExtension {
  return {
    id: 'callout',
    activate({ workbench, visualEditor, subscriptions }) {
      subscriptions.push(workbench.registerStyleSheet(CSS), visualEditor.registerNode(CALLOUT), visualEditor.registerToolbarItem(INSERT_CALLOUT));
    },
  };
}

createTypstEditor(host, { extensions: (builtinExtensions) => [...builtinExtensions, callout()] });
```
== Around the constructs <architecture-visual-editor-constructs-more>

#table(
  columns: 2,
  [Contribution point], [What],
  [`registerToolbarGroup(group)`], [A `group` in the row, a `menu` button, or a `floating` bar. The host's: `history`, `text-style`, the `insert` menu, the floating `selection` bar],
  [`registerToolbarItem(item)`], [A button in a group: an `action` (`run(chain)` or `click()`), `create(toolbar)` for per-editor state, or `provideActions(toolbar)` in a menu. `keywords` feed the slash commands],
  [`registerTextStyleProvider(provider)`], [Entries of the text style menu (heading levels, custom styles)],
  [`registerCompletionItemProvider(provider, trigger)`], [A list that pops up after a trigger character (@architecture-visual-editor-constructs-completion)],
  [`registerRawBoxRenderer(provider, { priority })`], [What raw boxes show instead of their code (images 110, compiled snippets 100)],
  [`registerHighlights(layer, provider)`], [Styled source ranges over the text (diagnostics, others' selections)],
  [`registerTiptapExtension(editor => extension)`], [Per-editor plugins, decorations, commands],
  [`registerRawBoxCodeMirrorExtension(editor => extension)`], [CodeMirror extensions for the code of every raw box],
)

- *`insertTypst(editor, source, at?)`* inserts Typst as the Visual editor reads it: inline content into the text, blocks after the block there. Use it for Insert entries easier written as Typst ("Insert diagram") and help snippets.
- *Registration* happens once; the host applies it to every editor, also the ones created later.
- *Per-editor things* come through `…Provider` functions, which get the `VisualEditorContext`: `document`, `selection()`, `sourceToPos`, `posToSource`, `isBox(node)`.
- *`editRawBox(pos, offset)`* (a Tiptap command) focuses a raw box's code at `offset`, e.g. between the dollars of a new `$$`.
- *`setRawBoxDecorations`* tells a raw box's CodeMirror what the Visual editor draws on the box.
- *Box actions are document links:* ⌘-click or Alt+Enter on a box follows its primary link (@architecture-source-editor-and-preview-links). Diagrams mark their paths "Edit diagram" with a provider of priority 110.

== Completion lists <architecture-visual-editor-constructs-completion>

`registerCompletionItemProvider(provider, { char, allowedPrefixes? })` opens a list while `char` and a query are typed, as the labels after `@` and the slash commands after `/`.

- *Where:* `char` at the start of a text block or after one of `allowedPrefixes` (default: a space); never in code or raw boxes.
- *What:* `provideCompletionItems(context)` is asked on every keystroke. `context` adds `editor`, `query`, `toolbarActions(group)` and `textStyles()`, so you can offer what other extensions registered.
- *Filtering* is the host's: by `label` and `keywords`, case ignored, exact matches first.
- *Keys* as in VS Code: ↑ / ↓, Enter or Tab, Escape. Built on Tiptap's `Suggestion`.

#table(
  columns: 2,
  [`CompletionItem` field], [What],
  [`label`], [Shown and matched],
  [`detail?`], [Shown dimmed after the label],
  [`icon?`], [A toolbar icon (`svg(..)`) before the label],
  [`keywords?`], [Other words it is found by],
  [`commitCharacters?`], [Accept it, then type the character (`@intro` + `.`)],
  [`command({ editor, range })`], [Replaces `range` (trigger and query) on accept],
)

```ts
visualEditor.registerCompletionItemProvider(
  {
    provideCompletionItems: () =>
      ['TODO', 'FIXME'].map((tag) => ({ label: tag, command: ({ editor, range }) => editor.chain().focus().insertContentAt(range, `${tag}: `).run() })),
  },
  { char: '!' },
);
```
