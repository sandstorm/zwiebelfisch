#import "../template.typ": mermaid, unreviewed

= Central data structures <architecture-data-model>

The `TypstDocument` is the model for each `.typ` file. Every view (Visual editor, Source editor, collaboration, preview) listens to these changes, and edits it with the same change format.

The `Project` is the collection of many files.

#figure(
  mermaid(read("../diagrams/data-model.mmd"), width: 70%),
  caption: [Who owns what; everything below a `TypstDocument` is derived from it.],
)

== TypstDocument <architecture-data-model-document>

*The text of one `.typ` file* (`src/core/typst-document/`): a way to change it, and its `syntaxTree` (the Lezer tree).

- *Offsets are `SourceOffset`s* (UTF\-16, as string indices, Lezer and CodeMirror count).

== Changes <architecture-data-model-changes>

A `TextChange` is `{ from, to, insert }` (CodeMirror's `ChangeSpec` shape). A view edits with `document.change(TextChange[], origin)`. `origin` is an identifier for the view, so that it can ignore the events it emitted.

- A view *ignores events* whose `origin` is itself, and applies all other events to its internal state.
- *In order:* a listener that changes the document while being notified of a change queues its own change until everyone heard the first one.
- *Whole new texts* (a file loaded, a remote state adopted) call `setText`, which applies one minimal change, so cursors and undo survive.

#figure(
  mermaid(read("../diagrams/keystroke.mmd"), width: 95%),
  caption: [A keystroke in the Visual editor; listeners are told in subscription order.],
) <architecture-data-model-keystroke>

== From Typst to ProseMirror nodes <architecture-data-model-nodes>

The Visual editor's conversion code (`src/hosts/visual-editor/typst-conversion/`) is a stateless library: `parseTypst(text, schema)` makes the ProseMirror document from Typst text, `typstChanges(tr, text)` turns a Prosemirror transaction back into `TextChange`s, `applyTypstChanges(tr, parsed)` brings a document up to date with a new parse.

*The framework knows only paragraphs, text, escapes, shorthands and raw Typst.* Every other construct (heading, list, table, image, …) is registered through `visualEditor.registerNode()`.

Lezer gives the top level of a file as one flat list of syntax nodes; a blank line is just a `Parbreak` node in it. ProseMirror needs a tree of blocks. So `parseTypst` first finds where each block starts and ends (step 1), then decides what each block becomes (step 2). This example walks through both:

#table(
  columns: (auto, 1fr),
  table.header[Source][Lezer's syntax nodes, in order],
  [```typ = Intro```], [`Heading`, `Space` (the line break)],
  [```typ Some *bold* text and #mystery()```], [`Text`, `Space`, `Strong`, `Space`, `Text`, `Space`, `Hash`, `FuncCall`, `Space`],
  [```typ - one```], [`ListItem`, `Space`],
  [```typ - two```], [`ListItem`],
  [_(blank line)_], [`Parbreak`],
  [```typ #table(columns: 2, [a], [b])```], [`Hash`, `FuncCall`],
  [_(blank line)_], [`Parbreak`],
  [```typ #let x = 1```], [`Hash`, `LetBinding`],
)

*Step 1: cut the list into segments.* A segment becomes one block. The nodes are read in order:

- A node that is always a block of its own is a segment by itself, even without blank lines around it. This is defined with `standsAlone=true` in the extension, f.e. `Heading` (headings extension) or `ListItem` (lists extension).
- Every other node is added to the current *run*. A `Parbreak` (blank line) or a standalone node ends the run.

#table(
  columns: (auto, auto, 1fr),
  table.header[Segment][Kind][Source],
  [1], [standalone], [`= Intro`],
  [2], [run], [`Some *bold* text and #mystery()`],
  [3], [standalone], [`- one`],
  [4], [standalone], [`- two`],
  [5], [run], [`#table(columns: 2, [a], [b])`],
  [6], [run], [`#let x = 1`],
)

*Step 2: make a block of each segment.* A standalone segment becomes a block. For a run, the first rule that matches decides:

#table(
  columns: (1fr, 1.4fr, auto),
  table.header[The run is][It becomes][Here],
  [exactly one node an extension reads as a block], [that block (f.e. a `Raw` over several lines: a code block)], [—],
  [has text or other inline syntax in it], [a `paragraph`; each inline node goes through the extensions' inline rules (marks, inline nodes)], [segment 2],
  [exactly one `#call(..)`], [the block of the extension that reads that function], [segment 5: `table`],
  [anything else], [a `rawBlock`: the source verbatim, shown as code], [segment 6],
)

Inside a paragraph the same principle happens: inline syntax no extension reads becomes a `rawInline` (`#mystery()`). An extension's rule may also return `null` (it cannot write this construct back exactly); then the next rule is tried, and in the end the raw box is used. The result:

```
doc
├─ heading  level 1  src "= Intro"                          sep "\n"
├─ paragraph         src "Some *bold* text and #mystery()"  sep "\n"
│  ├─ text "Some "
│  ├─ text "bold"   mark bold
│  ├─ text " text and "
│  └─ rawInline      src "#mystery()"
├─ bulletList                                               sep "\n\n"
│  ├─ listItem                                              sep "\n"
│  └─ listItem
├─ table                                                    sep "\n\n"
│  └─ tableRow …
└─ rawBlock          src "#let x = 1"
```

- *Raw boxes:* as fallback, typst is shown as code in a box (`rawBlock`, `rawInline`).

- *Printing:* an unchanged node prints its `src`; an edited or new one calls `toTypst`. This ensures that an edit changes only the source of what it touched.
- *Position map:* `sourceToPos` and `posToSource` are the only conversion between `SourceOffset`s and ProseMirror positions, built while printing.

== Typing in the Visual editor <architecture-data-model-typing>

+ ProseMirror applies the keystroke as a transaction.
+ The Visual editor computes `typstChanges(tr, text)`, which creates one `TextChange` per touched textblock.
+ It calls `document.change(changes, this)` , which then triggers event listeners.

*The way back:* a change of another origin (Source editor, another user, an extension) reaches the Visual editor through `onDidChange`. It does not rebuild its document; `applyTypstChanges` changes only what differs, so the cursor and selection survive:

+ Parse the new text into a fresh document.
+ Compare it with the open document, ignoring the source attributes: `src`, `sep`, `label` (the invisible attributes in the ProseMirror syntax tree above). Without that, any edit inside a paragraph changes its `src`, so the whole paragraph would count as different and be replaced, and a cursor in it would jump.
+ Replace only the smallest range that really differs (a changed word, not its paragraph).
+ Copy the fresh `src`, `sep` and `label` onto the nodes in place.

That transaction stays out of the undo history: Ctrl+Z in the Visual editor undoes only what was typed there.

== Collaboration <architecture-data-model-collaboration>

The `collaboration` extension shares the project through one #link("https://yjs.dev/")[Yjs] `Y.Doc` per room, synced by a `HocuspocusProvider` with the Go server, or handed in by the host page (`collaboration({ doc })`, no server).

- *`TextBinding`* binds one `TypstDocument` to one `Y.Text`: local changes go into the `Y.Text` as one Y transaction each; another client's transaction comes back as `document.change(…, REMOTE_ORIGIN)`. From there it travels as any other change.

#table(
  columns: (auto, 1fr, auto),
  table.header[Y.Doc entry][Content][Rooms],
  [`files`], [`Y.Map<path, Y.Text>`: every `.typ` file], [all],
  [awareness], [`user`, `cursor` (relative positions): other users' carets], [all],
  [`project`], [`main`, the main file's path], [plain],
  [`assets`], [the other files: blob sha, or uploaded bytes not committed yet], [GitLab],
  [`meta`], [written by the server only: the base commit, `changes`, `conflict`, `commitFailure`, `autoCommit`, `pulledIn`], [GitLab],
)

=== GitLab rooms <architecture-data-model-gitlab>

The server holds no GitLab token of its own: everything a GitLab room does, it does with the token of a signed-in user (package `auth` keeps the tokens in memory and refreshes them; package `gitlab` asks it for one by user id).

#figure(
  mermaid(read("../diagrams/gitlab-tokens.mmd"), width: 85%),
  caption: [Whose token a GitLab room uses: the user it acts for.],
)

- *Loading, merging:* the token of who opens the room; a webhook's push, of someone in it (nobody: at the next join).
- *Saving:* the saver's, who is the commit's author; an auto-save, an editor's (who left last, else who edited most). The other editors are `Co-authored-by:` trailers, the committer is Zwiebelfisch.
- *The repository* is one bare, full git clone per project next to the SQLite file (`repositories/`): rooms read files from it only. Commits are built in memory and pushed only if the branch did not move. No token is ever written to it.
- *A room of one folder* (`…@<branch>:/<folder>`) holds the folder's files and the pulled-in ones (`meta.pulledIn`), at their repository paths: its base, merges and commits cover exactly these. The widget makes every other folder Readonly (`workspace.registerFileSystemProvider`), marks pulled-in files (a file decoration) and asks for what a compile misses (`gitlab:pull`); the server refuses commits that create, rename or delete outside the folder.
- *History* comes from the same clone (read lock only), checked as the room's files are (`Authenticate`); a room of one folder answers for its folder and pulled-in files only. Answers that name a commit are cached for good (`immutable`).
  - `GET /api/rooms/<room>/history?path=&cursor=`: the commits that changed `path` (`''` the room, `/dir/` a folder, `/a.typ` a file), newest first, 50 a page; people from the author and the `Co-authored-by:` trailers.
  - `GET /api/rooms/<room>/compare?sha=`: the files that commit changed against its first parent.
  - `GET /api/rooms/<room>/files/<path>?ref=<sha>`: a file at a commit.
