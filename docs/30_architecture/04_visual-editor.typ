= Visual editor <architecture-visual-editor>

The word-processor editor: a Tiptap 3 editor over the Typst ↔ ProseMirror conversion (@architecture-prosemirror-typst). Module `src/hosts/visual-editor/`.

== VisualEditor <architecture-visual-editor-class>

```ts
new VisualEditor(parent, document, contributions: VisualEditorHost)
.reveal(range: SourceRange)    // select what shows the source range
.selection() → SourceRange     // the source range the selection shows
.onDidChangeSelection: Event<void>
.dispose()
```

- *Write-back:* after every transaction that changed the document, `document.setText(serializeToTypst(doc), this)`: one minimal change.
- *Read-back:* a change with another origin is parsed again and applied with `applyTypstChanges`, outside the undo history.
- *Mechanism kept:* paragraphs, text, raw boxes, the toolbar's frame (undo/redo, *Insert* menu, *Selection* bar), highlights, completion lists. Every other construct and feature is a contribution.

== VisualEditorHost <architecture-visual-editor-host>

What `ExtensionContext.visualEditor` is. Contributions register once, at activation; the host applies them to every editor it creates later. No contribution tracks editors.

- Constructs: `registerNode`, `registerMark` (@extensions-visual-editor-constructs).
- Around them: Tiptap extensions per editor, toolbar groups and items, text style providers, completion item providers, gutters, highlights, box renderers, raw-box CodeMirror extensions (@extensions-visual-editor-constructs-more).
- Who wins where they compete: @architecture-conventions-api.
- Where raw boxes' pictures lead (`RawBoxLinks`, given by the workbench, not contributed): the primary document link of a box's Typst (`languages`), so the host knows no links.

== VisualEditorContext <architecture-visual-editor-context>

What every `…Provider` gets for one editor: `document`, `selection()`, `isBox(node)`, and the position map (`sourceToPos`, `posToSource`) over any document of the editor, e.g. a transaction's. Toolbar items made per editor also get Tiptap's `editor`.

== Raw boxes <architecture-visual-editor-raw-boxes>

Typst no spec models, and nodes whose spec sets `view.box: 'code'` (images, outlines), show as raw boxes:

- A nested CodeMirror edits the node's `src`. Each edit is an attribute step; the serializer prints `src` verbatim, so the source changes exactly there.
- An outside change of `src` reaches the box as one minimal change.
- Undo and redo run the Visual editor's history. Arrow keys, Escape and Enter move between box and text.
- With a box renderer, the box shows a picture until its code gets focus (the preview's boxes of its range, @architecture-preview-concepts). Until the renderer has one (before the first compile) it shows its code; a picture is decoded before it replaces the code or the one before (no blank in between) and fades in.
- When the renderer changes (after every compile), only boxes near the view (an `IntersectionObserver`, one viewport above and below) are drawn again; one further away, or in a hidden editor, is drawn again once it comes near.
- The spec's `view.title` heads the box; `view.tools` add tools (an image's resize handles and toolbar).
- The picture is a link to where the box's Typst leads (`RawBoxLinks`): its tooltip says where; with Mod held it shows as one; Mod+click on it, or Alt+Enter on the selected box, follows it. Other clicks still select the box or edit its code.
- `setRawBoxDecorations`: the box's node decorations, handed to its code (another user's caret inside the box).

== Toolbar <architecture-visual-editor-toolbar>

- Laid out from contributed groups (a button group, a menu, a bar floating in the text) sorted by `order`, and items by `group` + `order`. Groups without items are left out.
- The host's own: `history` (undo/redo, 10), `text-style` (20, once a provider exists), the `insert` menu (50), the floating `selection` bar.
- Buttons are `ToolbarAction`s: a Tiptap chain command, dry-run to disable the button: in the row after every transaction, in a menu when it opens and while it is open, in a floating bar while it shows; the text style menu's options when it is pressed or focused (what is not shown is not asked). They never take the focus from the text.

== Completion lists <architecture-visual-editor-completion>

- One Tiptap `Suggestion` plugin per registered provider and editor (`suggestions/suggestions.ts`), with the host's own match (trigger at a block start or after an allowed prefix; never in code) and a `SuggestWidget` (`listbox`) in the text column, placed by the plugin's Floating UI `mount`.
- The items are asked for synchronously on every keystroke and filtered by the host; a list without matches is not open, so its keys go on to the editor.
- Providers get the editor's toolbar entries and text styles (`toolbarActions(group)`, `textStyles()`): the slash commands offer what other extensions registered without knowing them.

Writing a construct: @extensions-visual-editor-constructs.
