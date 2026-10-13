= Visual editor <architecture-visual-editor>

The word-processor editor: a #link("https://tiptap.dev/")[Tiptap] 3 editor over the Typst ↔ ProseMirror conversion (@architecture-prosemirror-typst). Module `src/hosts/visual-editor/`.

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

- *Write-back:* after every transaction that changed the document, `document.setText(serializeToTypst(doc), this)`: one minimal change.
- *Read-back:* a change with another origin is parsed again and applied with `applyTypstChanges`, outside the undo history.
- *Reveal* focuses first, then selects. Until the selection moves, `selection()` returns the range asked for, so the preview follows to where was asked (a figure's label shows as the caret below the figure).
- *Mechanism kept:* paragraphs, text, raw boxes, the toolbar's frame, highlights, completion lists, the clipboard, and the three below. Every other construct and feature is a contribution.
- *Block handle* (`block-handle.ts`): a grip beside the block under the pointer, as in Notion. Dragging it does what ProseMirror does for a selected node, so the drop moves the block in one undo step.
- *Tab stays in the text* (`tab-keys.ts`): in code (a text block whose spec has `code`) Tab and Shift+Tab indent and outdent the selected lines by two spaces, before lists and tables; elsewhere constructs take Tab first, a lowest-priority catch-all the rest. Escape, then Tab leaves, as in CodeMirror.
- *Block gaps* (`block-gaps.ts`): a caret before or after a box (a block style, figure, table, raw box or code block; not a list), as CKEditor 5's widget caret. Arrow keys go one level at a time; typing there makes a paragraph. It is a selection of its own (`BlockGap`), used instead of ProseMirror's gap cursor; `reveal` of its source offset gives the gap again.

== Clipboard <architecture-visual-editor-clipboard>

The clipboard holds Typst (`clipboard.ts`), so text moves between the Visual editor, the Source editor and other editors as written.

- *Copy, cut:* `text/plain` and `text/x-typst` hold the selection's Typst: its source as written where that reads as what is selected, else printed anew. `text/html` goes along for rich targets.
- *Cut with nothing selected* cuts the block at the caret (`caretBlock`), as IntelliJ cuts the line.
- *Paste:* Typst, plain text and code are read with the editor's specs (`parseTypst`) and replace the selection in one undo step. Code is what VS Code copies, or HTML whose text is all code (`pre`, `code`, monospace: GitHub, documentation sites); code of another language becomes a code block of it (`pasted-typst.ts`).
- *Other HTML* (a web page, a word processor) is read by the schema's HTML rules, printed as Typst (`typst.html`) and read back. Extensions may clean it first (`transformPastedHTML`: `wordProcessors`). Our own HTML is not read back.
- *⌘⇧V* pastes plain characters, escaped. In raw boxes and code blocks the text goes in as is.
- *Paste as* (`paste-as.ts`): a paste goes in as the first of its alternative edits (`sortPasteEdits`); with more than one, a chip above its end ("Paste as: Typst ▾", Mod+., `editor.action.pasteAs`) switches the kind, in one undo step.
- *Paste edit providers* (`languages.registerDocumentPasteEditProvider`, @architecture-workbench-api-paste) change the pasted Typst (a label already taken gets a new name) and the rest of the text (the imports it needs), in the paste's transaction.

== VisualEditorHost <architecture-visual-editor-host>

What `ExtensionContext.visualEditor` is. Contributions register once, at activation; the host applies them to every editor it creates. No contribution tracks editors.

```ts
visualEditor.registerNode(spec)                  // constructs
visualEditor.registerMark(spec)
visualEditor.registerTiptapExtension(provider)   // around them
visualEditor.registerToolbarGroup(group)
visualEditor.registerToolbarItem(item)
visualEditor.registerTextStyleProvider(provider)
visualEditor.registerCompletionItemProvider(provider, trigger)
visualEditor.registerHighlights(layer, provider)
visualEditor.registerRawBoxRenderer(provider, options?)
visualEditor.registerRawBoxCodeMirrorExtension(provider)
```

- *Writing one:* constructs @architecture-visual-editor-constructs, the rest @architecture-visual-editor-constructs-more.
- *Who wins* where contributions compete: @architecture-extensions-overview-rules.
- *Links* (`VisualEditorLinks`, given by the workbench): a raw box's picture leads where its Typst's primary document link does; text leads to the link at its source offset. The host knows no links itself.
- *Following a link* works as in every editor: hover shows the hint, ⌘ shows the link look, ⌘-click or Alt+Enter follows, a plain click edits.

== VisualEditorContext <architecture-visual-editor-context>

What every `…Provider` gets for one editor: `document`, `selection()`, `isBox(node)`, and the position map (`sourceToPos`, `posToSource`) over any document of the editor, e.g. a transaction's. Toolbar items made per editor also get Tiptap's `editor`.

== Raw boxes <architecture-visual-editor-raw-boxes>

Typst no spec models, and nodes whose spec sets `view.box: 'code'` (images, outlines), show as raw boxes.

- *Editing:* a nested CodeMirror edits the node's `src`. Each edit is an attribute step, so the source changes exactly there.
- *Keys:* undo and redo run the Visual editor's history. Arrow keys, Escape and Enter move between box and text. Tab and Shift+Tab indent and outdent a block box's lines.
- *Picture:* with a box renderer, the box shows a picture (the preview's boxes of its range, @architecture-preview-rules) until its code gets focus. Only boxes near the view are drawn again after a compile.
- `view.title` heads the box; `view.tools` add tools (an image's resize handles).
- *Link:* the picture leads where the box's Typst leads (`VisualEditorLinks`).
- `editRawBox(pos, from, to?)`: a Tiptap command that focuses the box's code with the cursor at `from` or `from..to` selected, e.g. after Insert → "Inline math", or to reveal a search match inside the box.
- `setRawBoxDecorations`: hands the box's decorations to its code (another user's caret inside the box).

== Toolbar <architecture-visual-editor-toolbar>

- *Layout:* contributed groups (a button group, a menu, a floating bar) sorted by `order`, items by `group` + `order`. Empty groups are left out.
- *The host's own:* `history` (undo/redo, 10), `text-style` (20, once a provider exists), the `insert` menu (50), the floating `selection` bar.
- *Buttons* are `ToolbarAction`s: a Tiptap chain command, dry-run to disable the button. They never take the focus from the text.
- *Menus in a bar:* a menu with `bar` sits among that bar's items; `provideActions` builds its items each time it opens.

== Completion lists <architecture-visual-editor-completion>

- *One Tiptap `Suggestion` plugin* per provider and editor (`suggestions/suggestions.ts`), with a `SuggestWidget` (`listbox`) in the text column. Never in code.
- Items are asked for synchronously on every keystroke and filtered by the host. A list without matches is closed, so its keys go to the editor.
- Providers get the editor's toolbar entries and text styles (`toolbarActions(group)`, `textStyles()`): the slash commands offer what other extensions registered without knowing them.
