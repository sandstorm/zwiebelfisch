#import "../template.typ": unreviewed

= Visual editor <architecture-visual-editor>

#unreviewed

The word-processor editor: a #link("https://tiptap.dev/")[Tiptap] 3 editor over its Typst ↔ ProseMirror conversion (@architecture-typst-conversion), in `src/hosts/visual-editor/`. The host keeps paragraphs, text, raw boxes, the toolbar's frame, highlights, completion lists and the undo history; every other construct and feature is a contribution. *Any Typst that no extension turns into a visual element (a node) is shown as its source code in a box (a raw box), editable as code and never rewritten.* `DocumentEditors` (`src/editor/widget/`) makes one per document: the custom editor `visualEditor` of `*.typ`, the default.


== VisualEditor <architecture-visual-editor-class>

`new VisualEditor(parent, document, host)`: `reveal`, `insert`, `edit` (one undo step), `selection`, `content` (what scrolls).


- *One source of truth,* the `TypstDocument`: an edit goes to it as `change(typstChanges(tr), this)`; changes of other origins come back through `applyTypstChanges`, outside the undo history.
- *Minimal changes:* one `TextChange` per textblock touched (the reverse of `applyTypstChanges`, @architecture-typst-conversion-sync), so a collaborator's edit between two edited places stays where it was; the text always equals `serializeToTypst(tr.doc)`.
- *Reveal* focuses first (ProseMirror scrolls only to a focused selection), then selects; until the selection moves, `selection()` returns the range asked for, so the preview follows to where was asked (a figure's label is the caret below the figure).
- *Carets beside boxes* are the `blockGaps` extension's (CKEditor 5's widget caret, a `BlockGap` selection instead of ProseMirror's gap cursor): the host asks ProseMirror's `createSelectionBetween` for a caret at a box's edge (a raw box left or deleted, `reveal`), which the extension answers, so `reveal` of its offset gives the gap again. Without it: `Selection.near`. Likewise the grip beside a block (`blockHandle`) and Tab staying in the text (`tabKeys`; without it an unclaimed Tab moves the focus).

== VisualEditorHost <architecture-visual-editor-host>

What `ExtensionContext.visualEditor` is (*experimental*): register nodes, marks, Tiptap extensions, submenus, floating bars, completion providers, highlight providers and raw box renderers and extensions; each returns a `Disposable`.

- *Helpers* (`visual-editor-helpers.ts`): `insertTypst(editor, source, at?)` inserts Typst as the editor reads it (Insert entries easier written as Typst, help snippets); `registerChainButton(context, menuId, button)` a command and its menu entry from a Tiptap chain (`chainCommand`); `svg(body)` a toolbar icon.
- *Positions* come from typst-conversion's `sourceToPos` / `posToSource`, over any document of the editor (a transaction's too); there is no other mapping.
- *Order* of competing contributions (toolbar, box renderers, nodes and their parse rules): @architecture-extensions-rules.
- *Raw boxes' code is a CodeMirror:* extensions add to it with `sourceEditor.registerCodeMirrorExtension({ editor: 'rawBox' }, ..)` (@architecture-source-editor-host); the widget hands those to this host (`rawBoxCodeMirrorExtensions`), which knows no Source editor.
- *Links* are the `documentLinks` extension's: a Tiptap extension for the text, a raw box extension for boxes' pictures. The host knows no links.

== Clipboard <architecture-visual-editor-clipboard>

The `clipboard` extension (`src/extensions/clipboard/`) makes the clipboard hold Typst, so text moves between the Visual editor, the Source editor and other editors as written. Without it ProseMirror's own copy and paste run (text as escaped characters, HTML by the schema's rules); raw boxes keep their Typst either way, through `data-src` in the HTML.

- *Copy, cut:* `text/plain` and `text/x-typst` hold the selection's source as written where that reads as what is selected, else printed anew; `text/html` for rich targets. Cut with nothing selected cuts the block (IntelliJ's line cut).
- *Paste* reads Typst, plain text and code with the editor's specs (`parseTypst`), one undo step; other HTML is read by the schema's HTML rules, printed as Typst and read back (`transformPastedHTML` may clean it first: `wordProcessors`). ⌘⇧V pastes escaped characters.
- *Paste as* (@architecture-window-paste) undoes the paste, then pastes the other kind, only where the undo gave back the text before the paste: never pasted twice.

== Raw boxes <architecture-visual-editor-raw-boxes>

Typst no spec models, and nodes whose spec sets `view.box: 'code'` (images, outlines), show as raw boxes. A box with a renderer shows its picture; focus or `editRawBox` shows its code (a nested CodeMirror over the node's `src`) until blur.

- *Edits* are attribute steps, so the source changes exactly there; undo stays the Visual editor's history.
- *Picture:* the first renderer that renders a box draws it (`registerRawBoxRenderer`; none: code). `renderedBoxes` draws the preview's boxes of the box's range (@architecture-preview-rules), after a compile only those near the view.
- *Raw box extensions* (`registerRawBoxExtension`) add to a box's element, e.g. a frame or links; `setRawBoxDecorations` tells them what is drawn on the node.
- *`editRawBox(pos, from, to?)`* (a Tiptap command) opens the code with a caret or selection.

== Constructs <architecture-visual-editor-constructs>

The built-in constructs (headings, lists, tables, images, figures, …) use the same API (`registerNode`, `registerMark`).


- *Vocabularies:* a spec groups its fields by whose concept they are. `tiptap` (with its `priority` and attributes) is Tiptap's, given to it untouched; `syntaxNodes` keys are Lezer's (codemirror-lang-typst: `Heading`, `ListItem`, `Raw`, `Strong`, `Ref`, `FuncCall`); `calls` keys and `toTypst` output are Typst's. A later spec of the same name extends the earlier (another `toTypst`, more parse rules) and omits `tiptap`.
- *Attributes:* the Tiptap extension declares every attribute it needs, `rendered: false` for those that keep its source (`src`, `sep`, its own `anchors`). `labelled` adds `label`.
- *Return `null` for anything you cannot write back exactly:* the next spec tries, and with no taker the source stays raw. Only edited nodes are written; the rest keeps its source.
- *Node groups* let constructs meet without naming each other: `figureBody` (what a figure may hold), `blockContainer` (blocks an alignment may wrap: table cells).
- `TypstParseContext`, `TypstSerializeState` and the helpers over Lezer nodes (`calleeName`, `callArguments`, `namedArgument`, `withHash`, `quote`, …): the d.ts.

== Toolbar <architecture-visual-editor-toolbar>

Buttons are VS Code's menus and commands: a command (`commands.registerCommand`) and an entry of a Visual editor menu (`window.registerMenuItem`), run with the `VisualEditorMenuContext` as its one argument.

A `Submenu` groups entries under one button; a `FloatingBar` is a menu shown where its `anchor` says (null: hidden).

```ts
// simplified from src/extensions/labels/visual-editor/visual-editor.ts
commands.registerCommand(ADD_LABEL, ({ tiptap }: VisualEditorMenuContext) =>
  startNewLabel(tiptap.view)),
window.registerMenuItem('visualEditor/insert', { ...ADD_LABEL_BUTTON, order: 80 }),
// in the selection's bar only where it applies, so the bar stays small
window.registerMenuItem('visualEditor/selection',
  { ...ADD_LABEL_BUTTON, order: 45, when: ADD_LABEL_BUTTON.enabled }),
```

- *State per editor, no context keys:* `when`, `enabled` and `toggled` are functions of the menu context, because the state lives in the Tiptap editor the menu is shown for; they are asked each time the menu shows (the row: after every transaction; a submenu or bar: only while open).
- *Extensions' menus:* submenus `visualEditor/align`, `visualEditor/inlineStyles`; floating bars `visualEditor/table`, `visualEditor/image`, `visualEditor/link`. "Normal text" stays the host's because the paragraph is the host's node.
- Buttons never take the focus from the text. `keywords` feed the slash commands.

== Completion lists <architecture-visual-editor-completion>

A provider answers items for the trigger character and the query typed after it; an item's `command` replaces both.

```ts
// simplified from src/extensions/labels/visual-editor/visual-editor.ts
// `@` lists the project's labels; choosing one inserts a reference
visualEditor.registerCompletionItemProvider({
  provideCompletionItems: () => labels.labels().map((label) => ({
    label: label.name,
    detail: describeLabel(label) ?? undefined,
    command: ({ tiptap, range }) =>
      tiptap.view.dispatch(insertReference(tiptap.state, range, label.name)),
  })),
}, { char: '@', allowedPrefixes: [' ', '(', '[', '{'] });
```

- *Synchronous, on every keystroke,* filtered by the host. A list without matches closes, so its keys go to the editor.
- *The slash commands know no other extension:* they read the menus (`window.getMenuItems(menuId, context)`) and run an entry's command.

== How extensions hook in <architecture-visual-editor-extensions>

A construct is a node spec (`registerNode`) plus its buttons (`registerChainButton`); the heading is one.

```ts
// simplified from src/extensions/headings/visual-editor/visual-editor.ts and headings.ts
const HEADING: TypstNodeSpec = {
  name: 'heading',
  tiptap: starterKitPart('typstHeading', { heading: {} }), // plus attributes src, sep
  typst: {
    parseTypst: {
      syntaxNodes: {
        Heading: { standsAlone: true, takesLabel: true, block: parseHeading },
      },
    },
    toTypst: (state, heading, pos) => {
      state.hidden(`${'='.repeat(heading.attrs.level)} `);
      state.textblock(heading, pos);
    },
    labelled: true,
  },
};
const HEADING_1: ChainButton = {
  command: 'headings.toggleHeading1', title: 'Heading 1', order: 10,
  chain: (chain) => chain.toggleHeading({ level: 1 }),
  toggled: ({ tiptap }) => tiptap.isActive('heading', { level: 1 }),
};
// activate(context):
//   visualEditor.registerNode(HEADING)
//   registerChainButton(context, 'visualEditor/textStyle', HEADING_1)
```

- *Without the headings extension* `= Title` stays a raw box: its source code in a box, editable as code, and no "Heading" in the text style menu. The same holds for every construct: no spec, no node.
- `parseHeading` stands for the spec's inline `block`: a `heading` textblock with the marker's level, the source (`src`) and what follows (`sep`).

=== A construct of your own: a callout <architecture-visual-editor-callout>

`#callout(title: "Tip")[…]` as a box with its title in a field and its content as editable text, plus "Callout" in the Insert menu. Editing the title rewrites only the call's head; a call it does not model (`#callout(kind: "x")[…]`) stays raw Typst. The whole example, with its node view and `parseCallout`: `src/index.visual-editor-construct.test.ts`.

```ts
/** As written while the title is; a new or retitled callout gets the call written anew. */
function calloutToTypst(
  state: TypstSerializeState, callout: ProseMirrorNode, pos: number,
): void {
  const layout: CalloutLayout | null = callout.attrs.layout; // { open, close, title }
  const title: string = callout.attrs.title;
  state.hidden(layout?.title === title
    ? layout.open
    : `#callout(title: ${quote(title)})[`);
  state.blocks(callout, pos + 1, '\n\n');
  state.closing(layout?.close ?? ']');
}

const CALLOUT: TypstNodeSpec = {
  name: 'callout',
  tiptap: Callout,
  typst: {
    parseTypst: { calls: { callout: { block: parseCallout } } },
    toTypst: calloutToTypst, anchors: ['layout'], labelled: true,
  },
};
// activate(context):
//   visualEditor.registerNode(CALLOUT)
//   registerChainButton(context, 'visualEditor/insert', INSERT_CALLOUT)
```
