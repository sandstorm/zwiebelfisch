= Visual view <architecture-visual-view>

The word-processor view: a Tiptap 3 editor over the projection (@architecture-projection). Module `src/hosts/visual-view/`.

== VisualView <architecture-visual-view-view>

```ts
new VisualView(parent, document, contributions: VisualViewHost)
.reveal(range: SourceRange)    // select what shows the source range
.selection() → SourceRange     // the source range the selection shows
.onDidChangeSelection: Event<void>
.dispose()
```

- *Write-back:* after every transaction that changed the document, `document.setText(serializeToTypst(doc), this)`: one minimal change.
- *Read-back:* a change with another origin is projected again and applied with `applyTypstChanges`, outside the undo history.
- *Mechanism kept:* paragraphs, text, raw boxes, the toolbar's frame (undo/redo, *Insert* menu, *Selection* bar), highlights. Every other construct and feature is a contribution.

== VisualViewHost <architecture-visual-view-host>

What `ExtensionContext.visualView` is. Contributions register once, at activation; the host applies them to every view it creates later. No contribution tracks views.

- Constructs: `registerNode`, `registerMark` (@extensions-visual-view-constructs).
- Around them: Tiptap extensions per view, toolbar groups and items, text style providers, gutters, highlights, box renderers, box actions, raw-box CodeMirror extensions (@extensions-visual-view-constructs-more).
- Who wins where they compete: @architecture-conventions-api.

== VisualViewContext <architecture-visual-view-context>

What every `…Provider` gets for one view: `document`, `selection()`, `isBox(node)`, and the position map (`sourceToPos`, `posToSource`) over any document of the view, e.g. a transaction's. Toolbar items made per view also get the `editor`.

== Raw boxes <architecture-visual-view-raw-boxes>

Typst no spec models, and nodes whose spec sets `view.box: 'code'` (images, outlines), show as raw boxes:

- A nested CodeMirror edits the node's `src`. Each edit is an attribute step; the projection prints `src` verbatim, so the source changes exactly there.
- An outside change of `src` reaches the box as one minimal change.
- Undo and redo run the Visual view's history. Arrow keys, Escape and Enter move between box and text.
- With a box renderer, the box shows a picture until its code gets focus.
- The spec's `view.title` heads the box; `view.tools` add tools (an image's resize handles and toolbar).
- `setBoxDecorations`: the box's node decorations, handed to its code (another user's caret inside the box).

== Toolbar <architecture-visual-view-toolbar>

- Laid out from contributed groups (a button group, a menu, a bar floating in the text) sorted by `order`, and items by `group` + `order`. Groups without items are left out.
- The host's own: `history` (undo/redo, 10), `text-style` (20, once a provider exists), the `insert` menu (50), the floating `selection` bar.
- Buttons are `ToolbarAction`s: a Tiptap chain command, dry-run after every transaction to disable the button. They never take the focus from the text.

Writing a construct: @extensions-visual-view-constructs.
