#import "../template.typ": api, unreviewed

= Visual editor <architecture-visual-editor>

#unreviewed

The word-processor editor: a #link("https://tiptap.dev/")[Tiptap] 3 editor over its Typst ↔ ProseMirror conversion (@architecture-typst-conversion), in `src/hosts/visual-editor/`. The host keeps paragraphs, text, raw boxes, the toolbar's frame, highlights, completion lists and the undo history; every other construct and feature is a contribution. *Typst nothing models shows as raw Typst in a box.*

== VisualEditor <architecture-visual-editor-class>

```ts
new VisualEditor(parent, document, contributions: VisualEditorHost)
.content                       // the text column below the toolbar: what scrolls
.reveal(range: SourceRange)    // focus, select what shows the source range, scroll to it
.insert(source: string)        // insert what the Typst reads as at the selection
.edit(changes: TextChange[])   // apply source changes as one undo step
.selection() → SourceRange     // the source range the selection shows; after reveal, the range revealed
.onDidChangeSelection: Event<void>
.dispose()
```

- *One source of truth:* the `TypstDocument`. After every transaction that changed the document (also those plugins append), `document.change(typstChanges(tr), this)`: one minimal `TextChange` per textblock touched, the reverse of `applyTypstChanges` (@architecture-typst-conversion-sync). An edit in two places leaves the text between them alone, so a collaborator's edit there stays where it was.
- *Always exactly `serializeToTypst(tr.doc)`:* the touched ranges grow to their textblocks; `posToSource` cuts the old and the new text into matching pieces, each diffed by `minimalChange`, and what lies between the cuts (blank lines, list markers, labels) is diffed the same way. Cuts out of order are dropped: at worst one change covers the whole edit. Each appended transaction starts from `document.text`, so a document that prints differently converges.
- *Read-back:* a change of another origin is parsed again and applied with `applyTypstChanges`, outside the undo history.
- *Reveal* focuses first (ProseMirror scrolls only to a focused selection), then selects; until the selection moves, `selection()` returns the range asked for, so the preview follows to where was asked (a figure's label is the caret below the figure).
- *Carets beside boxes* are the `blockGaps` extension's (CKEditor 5's widget caret, a `BlockGap` selection instead of ProseMirror's gap cursor): the host asks ProseMirror's `createSelectionBetween` for a caret at a box's edge (a raw box left or deleted, `reveal`), which the extension answers, so `reveal` of its offset gives the gap again. Without it: `Selection.near`. Likewise the grip beside a block (`blockHandle`) and Tab staying in the text (`tabKeys`; without it an unclaimed Tab moves the focus).

== VisualEditorHost <architecture-visual-editor-host>

What `ExtensionContext.visualEditor` is. *Experimental:* the shapes may change between versions.

#api("/src/hosts/visual-editor/visual-editor.ts", "VisualEditorContributions")
#api("/src/hosts/visual-editor/visual-editor.ts", "VisualEditorContext")
#api("/src/hosts/visual-editor/visual-editor.ts", "SourceHighlightProvider")

- *Helpers* (`visual-editor-helpers.ts`): `insertTypst(editor, source, at?)` inserts Typst as the editor reads it (Insert entries easier written as Typst, help snippets); `registerChainButton(context, menuId, button)` a command and its menu entry from a Tiptap chain (`chainCommand`); `svg(body)` a toolbar icon.
- *Positions* come from typst-conversion's `sourceToPos` / `posToSource`, over any document of the editor (a transaction's too); there is no other mapping.
- *Order* of competing contributions (toolbar, box renderers, nodes and their parse rules): @architecture-extensions-rules.
- *Raw boxes' code is a CodeMirror:* extensions add to it with `sourceEditor.registerCodeMirrorExtension({ editor: 'rawBox' }, ..)` (@architecture-source-editor-host); the widget hands those to this host (`rawBoxCodeMirrorExtensions`), which knows no Source editor.
- *Links* are the `documentLinks` extension's (@architecture-source-editor-links): a Tiptap extension for the text, a raw box extension for boxes' pictures. The host knows no links.

== Clipboard <architecture-visual-editor-clipboard>

The `clipboard` extension (`src/extensions/clipboard/`) makes the clipboard hold Typst, so text moves between the Visual editor, the Source editor and other editors as written. Without it ProseMirror's own copy and paste run (text as escaped characters, HTML by the schema's rules); raw boxes keep their Typst either way, through `data-src` in the HTML.

- *Copy, cut:* `text/plain` and `text/x-typst` hold the selection's source as written where that reads as what is selected, else printed anew; `text/html` for rich targets. Cut with nothing selected cuts the block (IntelliJ's line cut).
- *Paste* reads Typst, plain text and code with the editor's specs (`parseTypst`), one undo step; other HTML is read by the schema's HTML rules, printed as Typst and read back (`transformPastedHTML` may clean it first: `wordProcessors`). ⌘⇧V pastes escaped characters.
- *Paste as* (@architecture-window-paste) undoes the paste, then pastes the other kind, only where the undo gave back the text before the paste: never pasted twice.

== Raw boxes <architecture-visual-editor-raw-boxes>

Typst no spec models, and nodes whose spec sets `view.box: 'code'` (images, outlines), show as raw boxes: a nested CodeMirror edits the node's `src`, each edit an attribute step, so the source changes exactly there. Undo and redo stay the Visual editor's history.

#api("/src/hosts/visual-editor/visual-editor.ts", "RawBoxRenderer")
#api("/src/hosts/visual-editor/visual-editor.ts", "RawBoxContext")
#api("/src/hosts/visual-editor/visual-editor.ts", "RawBoxExtension")
#api("/src/hosts/visual-editor/visual-editor.ts", "setRawBoxDecorations")

- *Picture:* the compiled-snippet renderer shows the preview's boxes of the box's range (@architecture-preview-rules) until its code gets focus; only boxes near the view are drawn again after a compile.
- *`editRawBox(pos, from, to?)`* (a Tiptap command) opens the code with a caret or selection: `reveal` of a range inside a box, Insert → "Inline math".

== Constructs <architecture-visual-editor-constructs>

The built-in constructs (headings, lists, tables, images, figures, …) use the same API. A spec groups its fields by whose concept they are:

#api("/src/hosts/visual-editor/visual-editor.ts", "TypstNodeSpec")
#api("/src/hosts/visual-editor/typst-conversion/typst-conversion.ts", "TypstNodeConversion", docs: "first-sentence")
#api("/src/hosts/visual-editor/typst-conversion/typst-conversion.ts", "TypstParseRules", docs: "first-sentence")

- *Vocabularies:* `tiptap` (with its `priority` and attributes) is Tiptap's, given to it untouched; `syntaxNodes` keys are Lezer's (codemirror-lang-typst: `Heading`, `ListItem`, `Raw`, `Strong`, `Ref`, `FuncCall`); `calls` keys and `toTypst` output are Typst's. A later spec of the same name extends the earlier (another `toTypst`, more parse rules) and omits `tiptap`.
- *Attributes:* the Tiptap extension declares every attribute it needs, `rendered: false` for those that keep its source (`src`, `sep`, its own `anchors`). `labelled` adds `label`.
- *Return `null` for anything you cannot write back exactly:* the next spec tries, and with no taker the source stays raw. Only edited nodes are written; the rest keeps its source.
- *Node groups* let constructs meet without naming each other: `figureBody` (what a figure may hold), `blockContainer` (blocks an alignment may wrap: table cells).
- `TypstParseContext`, `TypstSerializeState` and the helpers over Lezer nodes (`calleeName`, `callArguments`, `namedArgument`, `withHash`, `quote`, …): the d.ts.

== Toolbar <architecture-visual-editor-toolbar>

Buttons are VS Code's menus and commands: a command (`commands.registerCommand`) and an entry of a Visual editor menu (`window.registerMenuItem`), run with the `VisualEditorMenuContext` as its one argument.

#api("/src/hosts/visual-editor/visual-editor.ts", "VisualEditorMenuContext")
#api("/src/hosts/visual-editor/visual-editor.ts", "Submenu")
#api("/src/hosts/visual-editor/visual-editor.ts", "FloatingBar")

```ts
commands.registerCommand('callout.insert', ({ tiptap }: VisualEditorMenuContext) => tiptap.chain().focus().wrapIn('callout').run());
window.registerMenuItem<VisualEditorMenuContext>('visualEditor/insert', {
  command: 'callout.insert', title: 'Callout', icon, order: 80,
  enabled: ({ tiptap }) => tiptap.can().wrapIn('callout'),
});
```

- *State per editor, no context keys:* `when`, `enabled` and `toggled` are functions of the menu context, because the state lives in the Tiptap editor the menu is shown for; they are asked each time the menu shows (the row: after every transaction; a submenu or bar: only while open).
- *Extensions' menus:* submenus `visualEditor/align`, `visualEditor/inlineStyles`; floating bars `visualEditor/table`, `visualEditor/image`, `visualEditor/link`. "Normal text" stays the host's because the paragraph is the host's node.
- Buttons never take the focus from the text. `keywords` feed the slash commands.

== Completion lists <architecture-visual-editor-completion>

#api("/src/hosts/visual-editor/visual-editor.ts", "CompletionTrigger")
#api("/src/hosts/visual-editor/visual-editor.ts", "CompletionItemProvider")

```ts
visualEditor.registerCompletionItemProvider(
  { provideCompletionItems: () => ['TODO', 'FIXME'].map((tag) => ({
      label: tag, command: ({ tiptap, range }) => tiptap.chain().focus().insertContentAt(range, `${tag}: `).run() })) },
  { char: '!' },
);
```

- *Synchronous, on every keystroke,* filtered by the host. A list without matches closes, so its keys go to the editor.
- *The slash commands know no other extension:* they read the menus (`window.getMenuItems(menuId, context)`) and run an entry's command.

== Example: a callout <architecture-visual-editor-callout>

`#callout(title: "Tip")[…]` as a box with its title in a field and its content as editable text, plus "Callout" in the Insert menu. Editing the title rewrites only the call's head; a call it does not model (`#callout(kind: "x")[…]`) stays raw Typst. The whole example, with its node view and `parseCallout`: `src/index.visual-editor-construct.test.ts`.

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
// activate(context): visualEditor.registerNode(CALLOUT), registerChainButton(context, 'visualEditor/insert', INSERT_CALLOUT)
```
