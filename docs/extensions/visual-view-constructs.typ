= Visual view constructs <extensions-visual-view-constructs>

The Visual view models a Typst construct only when an extension contributes it; anything else shows as raw Typst in a box. The built-in constructs (headings, lists, tables, images, figures, …) use this same API.

- `context.visualView.registerNode(spec)`: a block or inline node (`TypstNodeSpec`).
- `context.visualView.registerMark(spec)`: inline formatting (`TypstMarkSpec`).
- *Experimental:* the shapes may change between versions.

How the Typst ↔ ProseMirror conversion keeps untouched source byte for byte: @architecture-prosemirror-typst.

== The spec <extensions-visual-view-constructs-spec>

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
  // what the Visual view does for its nodes (nodes only)
  view: { box, title, tools, keepsDom, ownsPseudoElements },
}
```

#table(
  columns: 3,
  [Field], [Whose], [What],
  [`name`, `typst`, `view`], [ours], [The Typst side and the view's handling],
  [`tiptap`, its `priority` and attributes], [Tiptap], [The node or mark type; omit it when another spec of the same name defines it],
  [`parseTypst.syntaxNodes` keys, the nodes parse functions get], [Lezer + codemirror-lang-typst 0.6.0], [`Heading`, `ListItem`, `Raw`, `Strong`, `Ref`, `FuncCall`],
  [`parseTypst.calls` keys, what `toTypst` writes], [the Typst language], [Function names, Typst source],
)

=== The node <extensions-visual-view-constructs-node>

- Its Tiptap extension declares every attribute it needs, including the ones that keep its source, all `rendered: false`: `sep` (the whitespace to the next block), `src` (an atom's Typst) and whatever remembers how the source was written (the callout's `layout`).
- A `labelled` spec's node gets a `label` attribute from the host: a label (`<tip>`) after the block.
- Its Tiptap `priority` (default 100, higher first) orders the schema (a group's first node type is its default), mark nesting (a higher mark outside a lower one), keymaps, plugins and parse rules.
- Two specs of the same name: the later one in that order extends the earlier (another `toTypst`, more parse rules).

=== Reading Typst <extensions-visual-view-constructs-parse>

- Each parse function gets the `TypstParseContext` and the Lezer node (for a call: its `FuncCall`), and returns the node, or `null` to let the next spec try. With no taker the source stays raw.
- *Return `null` for anything you cannot write back exactly.*
- Of specs reading the same syntax or call, the one with the higher Tiptap priority is asked first (task lists, 110, before bullet lists).
- `block(p, node, sep)`: the block a run of markup that is exactly this node becomes. `inline(p, node, marks)`: a node, or placed content (`PlacedNode[]`), in running text.
- `standsAlone`: a block even without paragraph breaks around it (`Heading`, `ListItem`). `takesLabel`: a label right after it is its label.
- `inRunningText(p, call)`: the call belongs in running text even where `inline` leaves it raw.

`TypstParseContext`: `schema`, `source`, `text(range)` (a `SourceRange` or a syntax node), `blocks(contentBlock)` (the blocks and their `from`, `to`), `inline(nodes, marks?)`, `blockCall(call)`, `isOneParagraph(nodes)`, `textblock(…)`, `unchangedNode(type, attrs, content?)`, `raw(src, marks?)`, `serial()`.

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

=== Writing Typst <extensions-visual-view-constructs-serialize>

- Only an *edited* node is written; untouched source stays byte for byte.
- `toTypst(state, node, pos, parent)` writes through the `TypstSerializeState`: `hidden(src)` (syntax the view does not show), `shown(src, kind, from, to)`, `blocks(node, start, sep)` (its children), `block`, `textblock`, `inline`, `item`, `closing(src)`, `after(src)`, `indented(print)`, `endBlock`.
- Default without `toTypst`: textblocks write their inline content, block atoms their `src`. Inline atoms write `atomToTypst(node)`.
- `anchors`: the attributes that remember how the source was written, so a fresh parse updates them in place, as it does `src` and `sep`.
- `container(item)`: consecutive nodes of this type form a container of the returned type (list items, their list).
- `onDidChange`: what the spec reads changed (a style declared); views parse their documents again.
- A mark's `toTypst(mark, around)` returns `{ open, close }` (`*…*`, or `#strong[…]` where delimiters would not work); `raw` marks write their text unescaped, `isBare` says when nothing is needed around a span.

=== Node groups <extensions-visual-view-constructs-groups>

Constructs meet through Tiptap node groups, without naming each other:

- `figureBody`: what a figure may hold as its body (images and tables join it: `group: 'block figureBody'`).
- `blockContainer`: holds blocks an alignment may wrap (table cells).

== Example: a callout <extensions-visual-view-constructs-callout>

`#callout(title: "Tip")[…]` as a box with its title in a field and its content as editable text, plus "Callout" in the Insert menu.

- Editing the title rewrites only the call's head (`#callout(title: "…")[`).
- A call it does not model (`#callout(kind: "x")[…]`) stays raw Typst.
- Tested in `src/index.visual-view-construct.test.ts`.

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
    activate({ workbench, visualView, subscriptions }) {
      subscriptions.push(workbench.registerStyleSheet(CSS), visualView.registerNode(CALLOUT), visualView.registerToolbarItem(INSERT_CALLOUT));
    },
  };
}

createTypstEditor(host, { extensions: (builtinExtensions) => [...builtinExtensions, callout()] });
```

== Around the constructs <extensions-visual-view-constructs-more>

#table(
  columns: 2,
  [Contribution point], [What],
  [`registerToolbarGroup(group)`], [A place for items: a `group` in the row, a `menu` button, or a `floating` bar at an anchor. The host's: `history` (order 10), `text-style` (20), the `insert` menu (50), the floating `selection` bar],
  [`registerToolbarItem(item)`], [A button in a group by `group` + `order`: an `action` (`run(chain)`: a Tiptap command chain, also dry-run for enabled; or `click()`, asking first) or `create(toolbar)` for an item with state per view. `keywords`: other words the slash commands find it by],
  [`registerTextStyleProvider(provider)`], [Entries of the text style menu (heading levels, custom styles), with `keywords` as toolbar actions],
  [`registerCompletionItemProvider(provider, trigger)`], [A list that pops up while a trigger character and a query are typed (@extensions-visual-view-constructs-completion)],
  [`registerRawBoxRenderer(provider, { priority })`], [What raw boxes show instead of their code; the first by `priority` that `renders` a box draws it (images 110, compiled snippets 100); its `className` goes on the picture, for its CSS],
  [`registerRawBoxAction({ title, when?, run })`], [A button on every raw box `when` holds for (its Typst: `node.attrs.src`), in the box's tools or above its code; "Edit diagram" is one],
  [`registerGutter(provider)`], [A column beside the text, per view (the notes gutter)],
  [`registerHighlights(layer, provider)`], [Styled source ranges drawn over the text (diagnostics, others' selections)],
  [`registerTiptapExtension(view => extension)`], [Per-view plugins, decorations, commands; hooks see `this.editor`],
  [`registerRawBoxCodeMirrorExtension(view => extension)`], [CodeMirror extensions for the code of every raw box],
)

- Contributions register once; the host applies them to every view it creates (views are made lazily, per document). Disposing a registration takes it out of views created later.
- Per-view things (the document, a popover) come through the `…Provider` functions, which get the `VisualViewContext`: `document`, `selection()` (a `SourceRange`), `sourceToPos`, `posToSource` (the only way between `SourceOffset`s and ProseMirror positions), `isBox(node)`.
- `setRawBoxDecorations`: the effect through which a raw box's CodeMirror extension learns what the Visual view draws on its box.

== Completion lists <extensions-visual-view-constructs-completion>

`registerCompletionItemProvider(provider, { char, allowedPrefixes? })`: a list that opens while `char` and a query are typed in the text. The labels after `@` and the slash commands after `/` are two.

- *Where:* `char` at the start of a text block or after one of `allowedPrefixes` (default: a space); the query runs to the cursor, without spaces. Never in code (code blocks, inline code) nor raw boxes.
- *What:* `provideCompletionItems(context)` returns `CompletionItem`s, asked again on every keystroke. `context` is the `VisualViewContext` plus `editor`, `query`, `toolbarActions(group)` and `textStyles()` (what this view's toolbar shows: how one extension offers what others registered).
- *Filtering* is the host's: items whose `label` or `keywords` contain the query, case ignored; a label equal to it first, then labels starting with it, labels containing it, keywords containing it. No match: no list.
- *Keys:* ↑ / ↓ choose (wrapping), Enter or Tab accept, Escape closes until another trigger is typed. The pointer chooses, a click accepts. The editor keeps the focus and names the chosen option (`aria-activedescendant` of the `listbox`).
- Built on Tiptap's `Suggestion` (`@tiptap/suggestion`, placed with Floating UI); VS Code's names (`CompletionItem`, `commitCharacters`).

#table(
  columns: 2,
  [`CompletionItem` field], [What],
  [`label`], [Shown and matched],
  [`detail?`], [Shown dimmed after the label (what a label labels, `Insert`)],
  [`icon?`], [A toolbar icon (`svg(..)`) before the label],
  [`keywords?`], [Other words it is found by],
  [`commitCharacters?`], [Typed while the item is chosen: accept it, then type the character (`@intro` + `.`)],
  [`command({ editor, range })`], [Accepting it: replace `range` (the trigger and the query) with what it stands for],
)

```ts
visualView.registerCompletionItemProvider(
  {
    provideCompletionItems: () =>
      ['TODO', 'FIXME'].map((tag) => ({ label: tag, command: ({ editor, range }) => editor.chain().focus().insertContentAt(range, `${tag}: `).run() })),
  },
  { char: '!' },
);
```
