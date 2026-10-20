#import "/template.typ": unreviewed

= Visual editor <architecture-visual-editor>

#unreviewed

The word-processor editor: a #link("https://tiptap.dev/")[Tiptap] 3 editor over its Typst ↔ ProseMirror conversion (@architecture-typst-conversion, in `typst-conversion/`). Module `src/hosts/visual-editor/`. It models a Typst construct only when an extension contributes it; *anything else shows as raw Typst in a box*. Why it is built so: the doc comment of `VisualEditor` in `visual-editor-impl.ts`.

== VisualEditor <architecture-visual-editor-class>

```ts
new VisualEditor(parent, document, contributions: VisualEditorHost)
.content                       // the text column below the toolbar: what scrolls
.reveal(range: SourceRange)    // focus, select what shows the source range, scroll to it
.insert(source: string)        // insert what the Typst reads as at the selection
.selection() → SourceRange     // the source range the selection shows; after reveal, the range revealed
.onDidChangeSelection: Event<void>
.dispose()
```

- *Write-back:* after every transaction that changed the document, `document.change(typstChanges(tr), this)`: one minimal `TextChange` per textblock the transaction touched (the opposite of `applyTypstChanges`, @architecture-typst-conversion-sync). An edit in two places leaves the text between them alone, so a collaborator's edit there at the same time stays where it was.
  - *How:* the touched ranges (from `tr.mapping`; mark and attribute steps by their own range) grow to their textblocks' content; `posToSource` gives their source ranges in the old and the new text, which cut both texts into matching pieces. Each pair of pieces gets its `minimalChange`.
  - *Neighbours:* what a block's neighbours print (blank lines, list markers, a label, the document's leading whitespace) lies between the cuts and is diffed the same way, so the changes always give exactly `serializeToTypst(tr.doc)`. Cuts out of order are dropped; at worst one change covers the whole edit.
  - Transactions plugins append are written back in turn. Each starts from `document.text`, so a document that prints differently converges as well.
- *Read-back:* a change with another origin is parsed again and applied with `applyTypstChanges`, outside the undo history.
- *Reveal* focuses first, then selects. Until the selection moves, `selection()` returns the range asked for, so the preview follows to where was asked (a figure's label shows as the caret below the figure).
- *Mechanism kept:* paragraphs, text, raw boxes, the toolbar's frame, highlights, completion lists and the undo history. Every other construct and feature is a contribution, also:
  - *Block handle* (`blockHandle`): a grip beside the block under the pointer, as in Notion; dragging it does what ProseMirror does for a selected node, one undo step.
  - *Block gaps* (`blockGaps`): a caret before or after a box (a block style, figure, table, raw box or code block; not a list), as CKEditor 5's widget caret. Arrow keys go one level at a time; typing there makes a paragraph. It is a selection of its own (`BlockGap`) instead of ProseMirror's gap cursor. The host asks ProseMirror's `createSelectionBetween` for a caret at a box's edge (a raw box left or deleted, `reveal` of a caret), which the extension answers with the gap; so `reveal` of its source offset gives the gap again. Without it the caret goes to the text nearest (`Selection.near`).
  - *Tab stays in the text* (`tabKeys`): in code (a text block whose spec has `code`) Tab and Shift+Tab indent and outdent the selected lines by two spaces, before lists and tables; elsewhere constructs take Tab first, a lowest-priority catch-all the rest. Escape, then Tab leaves, as in CodeMirror. Without it, a Tab no construct takes moves the focus (ProseMirror's default).

== Clipboard <architecture-visual-editor-clipboard>

The `clipboard` extension (`src/extensions/clipboard/`) makes the clipboard hold Typst, so text moves between the Visual editor, the Source editor and other editors as written. Without it, ProseMirror's own copy and paste run: text goes in as characters (escaped when written back), HTML by the schema's rules; raw boxes keep their Typst through `data-src`.

- *Copy, cut:* `text/plain` and `text/x-typst` hold the selection's Typst: its source as written where that reads as what is selected, else printed anew. `text/html` goes along for rich targets.
- *Cut with nothing selected* cuts the block at the caret, as IntelliJ cuts the line.
- *Paste:* Typst, plain text and code are read with the editor's specs (`parseTypst`) and replace the selection in one undo step. Code is what VS Code copies, or HTML whose text is all code (`pre`, `code`, monospace); code of another language becomes a code block of it.
- *Other HTML* is read by the schema's HTML rules, printed as Typst and read back. Extensions may clean it first (`transformPastedHTML`: `wordProcessors`). Our own HTML is not read back. Raw boxes carry their Typst in it (`data-src`), so ProseMirror's own HTML clipboard keeps them.
- *⌘⇧V* pastes plain characters, escaped. In raw boxes and code blocks the text goes in as is.
- *Paste as:* a paste goes in as the first of its alternative edits (`sortPasteEdits`); with more than one, a chip above its end ("Paste as: Typst ▾", Mod+., `editor.action.pasteAs`) switches the kind, in one undo step: the paste is undone, then the other kind pasted, only where the undo gave back the text before the paste (never pasted twice).
- *Paste edit providers* (@architecture-workbench-paste) change the pasted Typst and the rest of the text in the paste's transaction.

== Raw boxes <architecture-visual-editor-raw-boxes>

Typst no spec models, and nodes whose spec sets `view.box: 'code'` (images, outlines), show as raw boxes.

- *Editing:* a nested CodeMirror edits the node's `src`. Each edit is an attribute step, so the source changes exactly there.
- *Keys:* undo and redo run the Visual editor's history. Arrow keys, Escape and Enter move between box and text. Tab and Shift+Tab indent and outdent a block box's lines.
- *Picture:* with a box renderer, the box shows a picture (the preview's boxes of its range, @architecture-preview-rules) until its code gets focus. Only boxes near the view are drawn again after a compile.
- `view.title` heads the box; raw box extensions (`registerRawBoxExtension`) add the rest (an image's resize handles, a picture's link).
- `editRawBox(pos, from, to?)`: a Tiptap command that focuses the box's code with the cursor at `from` or `from..to` selected (after Insert → "Inline math", to reveal a search match inside the box).
- `setRawBoxDecorations` hands what the Visual editor draws on the box to its code (another user's caret inside it): a CodeMirror effect, read by the box code's own extensions, which a raw box extension cannot reach.

== VisualEditorHost <architecture-visual-editor-host>

What `ExtensionContext.visualEditor` is. *Experimental:* the shapes may change between versions.

#table(
  columns: 2,
  [Contribution point], [What],
  [`registerNode(spec)`, `registerMark(spec)`], [A construct: `TypstNodeSpec`, `TypstMarkSpec` (below)],
  [`registerTiptapExtension(editor => extension)`], [Per-editor plugins, decorations, commands],
  [`registerSubmenu(submenu)`], [A menu button (`{ id, label, icon(context), parent, group?, order? }`) in the row or a floating bar, opening the entries of menu `id` (@architecture-visual-editor-toolbar)],
  [`registerFloatingBar(bar)`], [A bar floating above `anchor(context)` in the text (`{ id, label, order, anchor }`), holding the entries of menu `id`],
  [`registerCompletionItemProvider(provider, trigger)`], [A list after a trigger character (@architecture-visual-editor-completion)],
  [`registerHighlights(layer, provider)`], [Styled source ranges over the text (diagnostics, others' selections)],
  [`registerRawBoxRenderer(provider, options?)`], [What raw boxes show instead of their code],
  [`registerRawBoxExtension(box => extension | null)`], [Takes part in every raw box, deciding by `box.node()` (`dom`, `code`, `picture` or null, `tiptap`, `editor`, `src()`, `getPos()`, `editCode()`); returns `{ update?(node), dispose() }` or null. Called in registration order before the box listens to its picture, so stopping a `mousedown` there keeps the box closed],
)

- *Register once, at activation;* the host applies it to every editor, also later ones. No contribution tracks editors.
- *Per-editor things* come through `…Provider` functions, which get the `VisualEditorContext`: `document`, `selection()`, `isBox(node)`. Positions come from typst-conversion's `sourceToPos` / `posToSource`, over any document of the editor (e.g. a transaction's). The toolbar's menus are shown with the `VisualEditorMenuContext`: that, plus Tiptap's `editor`.
- *`svg(body)`* makes a toolbar icon (24×24 outline strokes in the text colour).
- *`chainCommand(chain)`* is a button's command from a Tiptap chain: `run` (the handler) and `enabled` (its dry run). *`registerChainButton({ commands, workbench }, menuId, button)`* registers both: the command and the menu entry.
- *`insertTypst(editor, source, at?)`* inserts Typst as the Visual editor reads it: inline content into the text, blocks after the block there. For Insert entries easier written as Typst ("Insert diagram") and help snippets.
- *Order* of competing contributions (toolbar, box renderers, nodes and their parse rules): @architecture-extensions-rules.
- *Raw boxes' code* is a CodeMirror: extensions add to it with `sourceEditor.registerCodeMirrorExtension({ editor: 'rawBox' }, ..)` (@architecture-source-editor-host); the workbench hands them to the Visual editor host, which knows no Source editor.
- *Links* are the `documentLinks` extension's (@architecture-source-editor-links): a Tiptap extension for the text, a raw box extension for raw boxes' pictures. The host knows no links.

== Constructs <architecture-visual-editor-constructs>

The built-in constructs (headings, lists, tables, images, figures, …) use the same API. A spec groups its fields by owner:

```ts
{
  name: 'callout',
  tiptap: Callout,  // Node.create(..): schema, attributes, node view, commands, keymap, priority; given to Tiptap untouched
  typst: {
    parseTypst: {   // which Typst it reads (ProseMirror's parseDOM, for Typst)
      syntaxNodes: { Heading: { block, standsAlone, takesLabel }, Strong: { inline } }, // by Lezer node name
      calls: { callout: { block }, link: { inline, inRunningText } }, // by function name ('*': any other)
    },
    toTypst,        // how an edited node is written back (ProseMirror's toDOM, for Typst)
    labelled, anchors, container, atomToTypst, escapeAfter, onDidChange,
  },
  view: { box, title, keepsDom }, // nodes only
}
```

- *Vocabularies:* `tiptap` (with its `priority` and attributes) is Tiptap's; `syntaxNodes` keys are Lezer's (codemirror-lang-typst 0.6.0: `Heading`, `ListItem`, `Raw`, `Strong`, `Ref`, `FuncCall`); `calls` keys and `toTypst` output are Typst's. Omit `tiptap` when another spec of the same name defines it; the later spec extends the earlier (another `toTypst`, more parse rules).
- *Attributes:* the Tiptap extension declares every attribute it needs, `rendered: false` for those that keep its source: `sep` (whitespace to the next block), `src` (an atom's Typst), and its own (the callout's `layout`). `labelled` adds a `label` attribute for a label (`<tip>`) after the block.
- *Reading:* `block(p, node, sep)` and `inline(p, node, marks)` get the `TypstParseContext` and return a node (inline: or `PlacedNode[]`) or `null`; `null` lets the next spec try, with no taker the source stays raw. *Return `null` for anything you cannot write back exactly.*
- *`standsAlone`:* a block even without blank lines around it. *`takesLabel`:* a label right after it is its label. *`inRunningText(p, call)`:* the call belongs in running text even where `inline` leaves it raw.
- *Writing:* only edited nodes are written; the rest keeps its source. `toTypst(state, node, pos, parent)` writes through the `TypstSerializeState`. Without it, textblocks write their inline content, block atoms their `src`, inline atoms `atomToTypst(node)`. A mark's `toTypst(mark, around)` returns `{ open, close }` (`*…*`, or `#strong[…]` where delimiters would not work).
- *`anchors`:* attributes a fresh parse updates in place, as `src` and `sep`. *`container(item)`:* consecutive nodes of this type form a container of the returned type (list items, their list). *`onDidChange`:* what the spec reads changed (a style declared); the Visual editors parse again.
- *Node groups* let constructs meet without naming each other: `figureBody` (what a figure may hold: `group: 'block figureBody'`), `blockContainer` (holds blocks an alignment may wrap: table cells).
- `TypstParseContext`, `TypstSerializeState` and the helpers over Lezer nodes (`calleeName`, `callArguments`, `namedArgument`, `trailingContent`, `withHash`, `decodeString`, `quote`, …): see the d.ts.

== Toolbar <architecture-visual-editor-toolbar>

Buttons are VS Code's menus and commands: a command (`commands.registerCommand`) and an entry of a Visual editor menu (`workbench.registerMenuItem`). The host draws the menus and runs an entry's command with the `VisualEditorMenuContext` (the editor, its Tiptap `editor`) as its one argument.

```ts
commands.registerCommand('callout.insert', ({ editor }: VisualEditorMenuContext) => editor.chain().focus().wrapIn('callout').run());
workbench.registerMenuItem<VisualEditorMenuContext>('visualEditor/insert', {
  command: 'callout.insert', title: 'Callout', icon, order: 80,
  enabled: ({ editor }) => editor.can().wrapIn('callout'),
});
```

- *Menus:* `visualEditor/toolbar` (the row, a group of buttons per `group` by name: `1_history`, `2_textStyle` the text style menu, `3_lists`, `4_align`, `5_insert`, `6_comments`), `visualEditor/insert` (the host's "Insert" submenu), `visualEditor/selection` (the host's bar above a text selection, order 10). Extensions add submenus (`visualEditor/align`, `visualEditor/inlineStyles` in the selection bar) and floating bars (`visualEditor/table`, `visualEditor/image`, `visualEditor/link`); of the bars with entries only the first by `order` with an anchor shows.
- *State per editor:* the entry's `when`, `enabled` and `toggled` are functions of the menu context, where VS Code has context keys: the state lives in the Tiptap editor the menu is shown for, so the entry asks it each time the menu shows (the row: after every transaction; a submenu or a bar: only while open or shown). `when` leaves a button out, `enabled` disables it, `toggled` shows it pressed.
- *How a button looks:* the entry's `icon`, else its `shortTitle` (`25%`), else its title; the title and the key as tooltip: the command's key binding, else the entry's `keybinding` (the editor's own key, `Mod+B`). Buttons never take the focus from the text. `keywords` feed the slash commands.
- *A submenu's icon* is a function of the context (the Align menu shows the selection's alignment); a submenu without entries is left out.
- *The text style menu* (`visualEditor/textStyle`, a `<select>` in the row's `2_textStyle`, shown while it has entries): the host's "Normal text", then the entries (heading levels: `headings`; block styles, inline styles, "New style…": `styles`), consecutive ones of one `category` under its title. Its value is the first entry whose `toggled` holds; entries of group `inline` are toggles instead (✓ where on, never the value). An entry chosen where it is on takes itself off; "Normal text" runs the value's command so, then makes the blocks paragraphs (the paragraph is the host's own node, so the host keeps it).

== Completion lists <architecture-visual-editor-completion>

`registerCompletionItemProvider(provider, { char, allowedPrefixes? })` opens a list while `char` and a query are typed, as the labels after `@` and the slash commands after `/`. `CompletionItem`: see the d.ts.

```ts
visualEditor.registerCompletionItemProvider(
  { provideCompletionItems: () => ['TODO', 'FIXME'].map((tag) => ({
      label: tag, command: ({ editor, range }) => editor.chain().focus().insertContentAt(range, `${tag}: `).run() })) },
  { char: '!' },
);
```

- *Where:* `char` at the start of a text block or after one of `allowedPrefixes` (default: a space); never in code or raw boxes.
- *Asked synchronously on every keystroke*, filtered by the host. A list without matches is closed, so its keys go to the editor.
- *Providers get* `editor` and `query`. The slash commands read the menus with `workbench.getMenuItems(menuId, context)` and run an entry's command: they offer what other extensions registered without knowing them.
- One Tiptap `Suggestion` plugin per provider and editor, with a `SuggestWidget` (`listbox`); keys as in VS Code.

== Example: a callout <architecture-visual-editor-callout>

`#callout(title: "Tip")[…]` as a box with its title in a field and its content as editable text, plus "Callout" in the Insert menu. Editing the title rewrites only the call's head; a call it does not model (`#callout(kind: "x")[…]`) stays raw Typst. The whole example, with its node view and `parseCallout`, is `src/index.visual-editor-construct.test.ts`.

```ts
/** As written while the title is; a new callout, or one with a changed title, gets the call written anew. */
function calloutToTypst(state: TypstSerializeState, callout: ProseMirrorNode, pos: number): void {
  const layout: CalloutLayout | null = callout.attrs.layout; // { open, close, title } as parsed
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

export function callout(): Extension {
  return {
    id: 'callout',
    activate(context) {
      const { workbench, visualEditor, subscriptions } = context;
      subscriptions.push(workbench.registerStyleSheet(CSS), visualEditor.registerNode(CALLOUT), registerChainButton(context, 'visualEditor/insert', INSERT_CALLOUT));
    },
  };
}
```
