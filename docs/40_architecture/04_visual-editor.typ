= Visual editor <architecture-visual-editor>

The word-processor editor: a Tiptap 3 editor over the Typst ↔ ProseMirror conversion (@architecture-prosemirror-typst). Module `src/hosts/visual-editor/`.

== VisualEditor <architecture-visual-editor-class>

```ts
new VisualEditor(parent, document, contributions: VisualEditorHost)
.reveal(range: SourceRange)    // focus, select what shows the source range, scroll to it
.selection() → SourceRange     // the source range the selection shows; after reveal, the range revealed
.onDidChangeSelection: Event<void>
.dispose()
```

- *Reveal:* the editor takes the focus first (ProseMirror scrolls to the DOM's selection, which it moves only while focused), then selects. What it selects may show the range only roughly: a figure's label is shown as the caret below the figure. Until the selection moves or the text changes, `selection()` says the range revealed, so who follows the selection (the preview) goes where was asked, not to the text after the figure.
- *Write-back:* after every transaction that changed the document, `document.setText(serializeToTypst(doc), this)`: one minimal change.
- *Read-back:* a change with another origin is parsed again and applied with `applyTypstChanges`, outside the undo history.
- *Mechanism kept:* paragraphs, text, raw boxes, the toolbar's frame (undo/redo, *Insert* menu, *Selection* bar), highlights, completion lists, the clipboard, the caret between blocks. Every other construct and feature is a contribution.
- *Block handle* (`block-handle.ts`): a grip in the text column's left padding beside the block under the pointer, found by the pointer's height alone (halving over the blocks' tops): a top-level block, or an item of a list (schema group `list`) at any depth; blocks inside a block style, a figure or a table move with it. Its `dragstart` does what ProseMirror's own does for a selected node (the grip is outside the editor's DOM): the block selected (`NodeSelection`), its HTML and Typst in the drag's data, the block as drag image, `view.dragging` with the node to delete. ProseMirror's drop then moves it (one undo step, the Typst verbatim); the drop cursor shows where. A click selects the block. Hidden while typing, after an edit, read-only. A drop on a raw box's code lands beside the box (`RawBox.stopEvent` lets the outer editor's drags through).
- *Tab stays in the text* (`tab-keys.ts`): in code (a textblock whose spec has `code`: code blocks) Tab and Shift+Tab indent and outdent the selected lines by two spaces, as CodeMirror's `indentWithTab`, before any construct (priority 200: code in a list item or table cell indents); elsewhere the constructs' keymaps take them first (lists, tables); a catch-all of the lowest Tiptap priority (1) consumes the rest. Escape, then Tab moves the focus on, once (no keyboard trap, as in CodeMirror), raw boxes included.
- *Block gaps* (`block-gaps.ts`): a caret before or after a block with no text of its own, as CKEditor 5 offers beside widgets, so one gets behind a block style, figure, table or raw box and sees whether the caret is inside or after it. A gap is a block boundary beside a box (a block that is no text block: a container or an atom), where a paragraph may go, never inside a list item; between paragraphs (headings, code blocks) there is none. A selection of its own (`BlockGap`, JSON `blockGap`), mapped through every change (outside edits, undo); it replaces ProseMirror's gap cursor, which needs both neighbours to end in no text (two block styles ending in code had none). Arrow keys go one stop at a time (end of the text in a box → the gap after it → the next block; a raw box's code leaves onto the gap beside it); typing, Enter, a paste at a gap make a paragraph there; Backspace / Delete select the box before / after; a click into the space between blocks puts it there. Drawn as a blinking accent line across the content. Its source offset (`posToSource` of its position) lies between the two blocks' sources; `reveal` of that offset is the gap again.

== Clipboard <architecture-visual-editor-clipboard>

The clipboard holds Typst (`clipboard.ts`), so text moves between the Visual editor, the Source editor and other editors as it is written.

- *Copy, cut:* `text/plain` is the selection's Typst: the source range it shows (`posToSource`), byte for byte, if that reads as what is selected; else the selection printed anew (part of a bold word: `*bo*`). Text within one block of code (a spec with `code`, a code block) is that text, without fences. `text/x-typst` holds the same text and says it is Typst. ProseMirror's `text/html` goes along for rich targets. A cut with nothing selected (`handleDOMEvents.cut`, before ProseMirror's own) first selects the block at the caret (`caretBlock`): its paragraph, or the outermost container holding only it (a list item, a quote), never past an isolating node (a table cell keeps its cell).
- *Paste:* Typst (`text/x-typst`), plain text, and code are read with the editor's specs (`parseTypst`) and replace the selection in one transaction: a paragraph at either end joins the text there, blocks stay blocks, what no spec models becomes raw boxes. One line no spec models (`$x^2$`, alone read as a raw block) pasted into a paragraph with text joins it as an inline raw box, as in the source. One undo step. Code is text VS Code copied (`vscode-editor-data`) or text whose HTML is code only (every text in `pre`, `code`, an editor's line, `white-space: pre` or a monospace font: GitHub, documentation sites, web code editors); code of another language than Typst (VS Code's mode, a class `language-X` or `highlight-source-X`) pastes as a code block of that language (`readTypst`; the editors' own paste edits, `typstPasteEdits`, `pasted-typst.ts`).
- Our own HTML is not read back: it leaves out what is never rendered (a raw box's `src`). Other HTML (a web page, a word processor) goes in as ProseMirror reads it (its `slice`, the schema's HTML rules), printed as Typst (`typst.html`) and read back as every paste. Extensions may clean the HTML before (ProseMirror's `transformPastedHTML` in a Tiptap extension: `wordProcessors`).
- *Mod+Shift+V* pastes plain characters, written escaped, a paragraph per line: the key down before the paste says so, as ProseMirror's own Shift.
- *Paste as* (`paste-as.ts`): a paste goes in as the first of the paste edits it offers (`pasteEditsOf`, ordered by `sortPasteEdits`): the editor's own, `typst`, `typst.code` (a code block), `text.plain` (plain characters, `escapeTypst`), `typst.html` (the HTML), after the paste edit providers' (@architecture-workbench-api-paste; `typst.markdown`, first where the text is surely Markdown); edits that put in the same Typst as an earlier one are left out. With more than one, the paste's choice opens: a chip (the floating bar `paste`, order 1) above the paste's end says the kind ("Typst ▾"); its click or Mod+. asks which kind (the workbench's quick pick, `PasteChoices`), as does `editor.action.pasteAs`. A change undoes the paste (its own history event: `closeHistory`) and pastes the other kind, so one undo takes back all. Every edit is asked and resolved by the paste edit providers at paste time (the clipboard is unreadable later). The choice closes on the next edit, a selection outside the pasted range, or Escape.
- Raw boxes paste into their code, as CodeMirror does; in code blocks the text goes in as it is.
- What a paste changes besides is not the host's: the paste edit providers (`languages.registerDocumentPasteEditProvider`, @architecture-workbench-api-paste), which the workbench hands to the host (`VisualEditorPasteEdits`), offer other kinds and resolve the edit that goes in: its Typst before it is read (a label already taken gets a new name) and the rest of the text (the imports it needs); a copy or cut lets them add to the clipboard. Their edits go into the paste's transaction, before the slice replaces the selection.

== VisualEditorHost <architecture-visual-editor-host>

What `ExtensionContext.visualEditor` is. Contributions register once, at activation; the host applies them to every editor it creates later. No contribution tracks editors.

- Constructs: `registerNode`, `registerMark` (@architecture-visual-editor-constructs).
- Around them: Tiptap extensions per editor, toolbar groups and items, text style providers, completion item providers, highlights, box renderers, raw-box CodeMirror extensions (@architecture-visual-editor-constructs-more).
- Who wins where they compete: @architecture-conventions-api.
- Where its links lead (`VisualEditorLinks`, given by the workbench, not contributed): a raw box's picture the primary document link of the box's Typst, the text (a reference chip, a link mark) the link at the source offset under the pointer or at the cursor (`languages`), so the host knows no links. Hovered, one shows as links do in every editor (`FollowableLink.hover`, the languages host's): the same hint after the same delay (`.typst-link-hint`, role=tooltip, describing the chip, the link's text or the picture), with Mod held the link look (`typst-link--mod`), no `title`; Mod+click or Alt+Enter follows it, a plain click edits.

== VisualEditorContext <architecture-visual-editor-context>

What every `…Provider` gets for one editor: `document`, `selection()`, `isBox(node)`, and the position map (`sourceToPos`, `posToSource`) over any document of the editor, e.g. a transaction's. Toolbar items made per editor also get Tiptap's `editor`.

== Raw boxes <architecture-visual-editor-raw-boxes>

Typst no spec models, and nodes whose spec sets `view.box: 'code'` (images, outlines), show as raw boxes:

- A nested CodeMirror edits the node's `src`. Each edit is an attribute step; the serializer prints `src` verbatim, so the source changes exactly there.
- An outside change of `src` reaches the box as one minimal change.
- Undo and redo run the Visual editor's history. Arrow keys, Escape and Enter move between box and text. Tab and Shift+Tab indent and outdent the selected lines of a block box's code; an inline box ignores them.
- With a box renderer, the box shows a picture until its code gets focus (the preview's boxes of its range, @architecture-preview-concepts); while focused it shows only its code, inline boxes as block boxes (the picture stays in the box, hidden, and shows again without a new render). Until the renderer has one (before the first compile) it shows its code; a picture is decoded before it replaces the code or the one before (no blank in between) and fades in.
- When the renderer changes (after every compile), only boxes near the view (an `IntersectionObserver`, one viewport above and below) are drawn again; one further away, or in a hidden editor, is drawn again once it comes near.
- The spec's `view.title` heads the box; `view.tools` add tools (an image's resize handles and toolbar).
- The picture is a link to where the box's Typst leads (`VisualEditorLinks`): hovered, it shows the hint of every link; with Mod held it shows as one (framed); Mod+click on it, or Alt+Enter on the selected box, follows it. Other clicks still select the box or edit its code.
- `editRawBox(pos, offset)` (a Tiptap command): focuses the code of the box at `pos`, the cursor at `offset`; for a box just inserted to be written in (Insert → "Inline math").
- `setRawBoxDecorations`: the box's node decorations, handed to its code (another user's caret inside the box).

== Toolbar <architecture-visual-editor-toolbar>

- Laid out from contributed groups (a button group, a menu, a bar floating in the text) sorted by `order`, and items by `group` + `order`. Groups without items are left out. A menu with a `bar` sits among that floating bar's items; its items may be provided anew each time it opens (`provideActions`: the project's inline styles).
- The host's own: `history` (undo/redo, 10), `text-style` (20, once a provider exists), the `insert` menu (50), the floating `selection` bar.
- Buttons are `ToolbarAction`s: a Tiptap chain command, dry-run to disable the button: in the row after every transaction, in a menu when it opens and while it is open, in a floating bar while it shows; the text style menu's options when it is pressed or focused (what is not shown is not asked). They never take the focus from the text.

== Completion lists <architecture-visual-editor-completion>

- One Tiptap `Suggestion` plugin per registered provider and editor (`suggestions/suggestions.ts`), with the host's own match (trigger at a block start or after an allowed prefix; never in code) and a `SuggestWidget` (`listbox`) in the text column, placed by the plugin's Floating UI `mount`.
- The items are asked for synchronously on every keystroke and filtered by the host; a list without matches is not open, so its keys go on to the editor.
- Providers get the editor's toolbar entries and text styles (`toolbarActions(group)`, `textStyles()`): the slash commands offer what other extensions registered without knowing them.

Writing a construct: @architecture-visual-editor-constructs.
