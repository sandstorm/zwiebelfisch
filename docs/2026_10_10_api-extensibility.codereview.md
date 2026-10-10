# Code review: API shape and extensibility

Scope: the production code under `src/` (composition root, Visual view, projection, schema, toolbar, Project,
the `<typst-editor>` element). Tests, the server and the wasm crate were not reviewed. Findings use the
Sandstorm guideline names (Ousterhout, *A Philosophy of Software Design*).

## The question: is the API shaped like ProseMirror or CodeMirror?

**No, not yet.** The core modules are well shaped, but there is no extension mechanism yet. Every feature
is wired in by hand, and a Typst construct's knowledge is spread over five to seven files.

What ProseMirror and CodeMirror get right, and what this code base lacks:

| Property | ProseMirror / CodeMirror | Here |
|---|---|---|
| One concept for "add behaviour" | `Plugin` / `Extension` (a value, composed in arrays) | none: options, hard-coded lists, `Widget` fields |
| A feature is self-contained | a plugin bundles state, view, keymap, commands | a construct is split across schema, projector, printer, box lists, toolbar |
| The core does not know the features | `EditorState` knows no plugin by name | `projection.ts` imports comment syntax; `Widget` knows spreadsheets |
| Small, stable core API | `state`, `transaction`, `dispatch` | `TypstDocument` is already like this (see below) |

### What is already in the right shape

- **`TypstDocument`** is a single source of truth, with `change(changes, origin)` / `onChange` and
  echo suppression by origin. This is CodeMirror's transaction/annotation idea, reduced to the minimum.
- **`Preview`** is a deep module. It hides the worker, request coalescing, lazy pages and px↔pt mapping
  behind `update` / `reveal` / `onJump`.
- **`Action`** (`toolbar-action.ts`) is a small, command-shaped value (`run`, `enabled`, `active`), close to a
  CodeMirror command plus keymap entry.
- **The engine boundary** decides offsets, pages, coordinates and paths once (see the ARCHITECTURE.md table).
- **The entry-file lint rule** keeps feature folders encapsulated.

### What the target shape could look like

Aim for **one concept with two levels**, and keep both internal until they have settled:

```ts
// 1. A Typst construct in the Visual view: everything about `#outline()` in one value.
interface TypstNodeSpec {
  node: Node | Mark;                       // Tiptap schema part
  calls?: Record<string, BlockProjector>;   // which Typst calls project to it
  print?: BlockPrinter;                    // how an edited one prints back
  box?: 'block' | 'inline';                // shown as a raw box (source atom)
  labelled?: boolean;                      // may carry a trailing <label>
  toolbar?: { insert?: Action[]; blocks?: Action[] };
}

// 2. A widget feature: comments, labels, styles, spreadsheets, versions, …
type TypstExtension = (ctx: {
  project: Project;
  preview: Preview;
  layout: { addPanel; addTabAction };
  request(change: FileChange): Promise<string | null>;
  open(path: string): void;
}) => { nodes?: TypstNodeSpec[]; fileViews?: Record<FileKind, FileView>; destroy(): void };
```

`createTypstEditor(host, { …, extensions })` then composes a default list, as CodeMirror's `basicSetup` does.
The projection, the schema, the raw-box sets and the toolbar iterate over the registered specs and stop
naming node types. The findings below show where this would remove change amplification.

## Findings

src/features/visual-view/projection/projection.ts:467 ✋ blocker — Information hiding
Knowledge about one Typst construct is spread across files. `outline`, for example, is defined in
`nodes/nodes.ts:291` (`extensions`) and `nodes/nodes.ts:55` (`LABELLED_BLOCKS`), and also appears in
`projection.ts:467` (`BLOCK_CALLS`), `nodes/raw-box.ts:24` (`RAW_TYPES`) and `toolbar/toolbar.ts:63` (`OUTLINE`).
`pageBreak` / `horizontalRule` add `projection/call-atoms.ts:16` and `toolbar-blocks.ts`. Edited blocks need
`PRINT_BLOCK` (`projection.ts:1159`). Adding a construct means editing five to seven places, and nothing tells
you which ones (unknown unknowns).
Fix: one `TypstNodeSpec` per construct (schema node, call projector, printer, box/label flags, toolbar
entries) in its own file. `BLOCK_CALLS`, `PRINT_BLOCK`, `RAW_TYPES`, `LABELLED_BLOCKS` and `callAtomType` are
derived from the list of specs.

src/features/visual-view/projection/projection.ts:53 ✋ blocker — Information hiding
The core projection imports the comments feature's syntax (`noteCallSyntax`, `printNoteCall`,
`rangeNoteSyntax` from `features/comments`). Margin notes are therefore known in `projection.ts`,
`nodes/margin-notes.ts`, `notes-gutter/note-list.ts`, `presence.ts:20` (`INLINE_BOXES`) and
`features/comments/`. The general mechanism (source-anchored projection) depends on one specific
feature, so comments cannot be removed, replaced or made optional.
Fix: comments contributes its `marginNote` / `noteRange` spec through the same registry as above. The
projection only asks the registered specs "is this call yours?".

src/core/project/project.ts:127 ✋ blocker — Do one thing, completely
`Project.replace` removes and adds entries without notifying any listener. Every subscriber is then stale,
so `Widget.replaceFiles` (`typst-editor.ts:340`) repairs them by hand: `collaboration.sync()`,
`views.retain()`, `changes.refresh()`, `labels.refresh()`, `styles.refresh()`. `LabelIndex.refresh` says so
in its docblock ("after `Project.replace`, which tells no listener"). A new project-derived index works until
a host assigns `files`, and nothing points to the list it must join.
Fix: `replace` emits its changes (or one `{ kind: 'reset' }` change), so `onChange` subscribers stay correct
by themselves. Then the `refresh()` methods and most of `replaceFiles` can be deleted.

src/typst-editor.ts:170 ⚠ should-fix — General-purpose underneath, special-purpose on top
`Widget` knows every feature by name: 20 fields and a hand-written `mount*` method per feature. File types
are special-cased in `open()` (`typst-editor.ts:256`: `fileKind(path) === 'spreadsheet'`, `assets.hide()`)
and in `saveSpreadsheet`. Adding a file viewer such as draw.io (see `docs/todo/drawio-diagrams.md`) or a side
panel such as the inspector means editing `Widget` in several places.
Fix: a `fileViews: Record<FileKind, FileView>` registry (`show(path, content)` / `hide()`), with `open()`
choosing by kind. Features become `TypstExtension`s that receive a small context (`project`, `preview`,
`layout`, `request`, `open`) and return `destroy`. `Widget` then only composes a list.

src/features/visual-view/visual-view.ts:22 ⚠ should-fix — General-purpose underneath, special-purpose on top
`VisualViewOptions` mirrors one caller's feature set: `comment`, `labels`, `styles`, `assets`, `renderer` and
`links` each add an option here, an option on `ToolbarOptions` and plumbing in `Widget.mountViews`
(`typst-editor.ts:272`). The constructor then special-cases each one (`setBoxRenderer`, `setBoxLinks`,
`referencesExtension({ labels })`, `menuStyles()`).
Fix: a ProseMirror-style `extensions` option. Labels, styles and comments each contribute their Tiptap
extensions and toolbar actions, and `VisualView` only needs the document and the extension list.

src/typst-editor-element.ts:85 ⚠ should-fix — Information hiding
`<typst-editor>` re-declares a hand-picked subset of `TypstEditorOptions` and maps it in
`connectedCallback`. `user` and `collaboration` are read only on connect, `setBase` (`:80`) drops the
`label` / `path` arguments of `TypstEditor.setBase`, and `mode`, `main` and `followCursor` are missing. Every
new option has to be added here as well, or the element silently lacks it.
Fix: keep one `options` property (`Partial<TypstEditorOptions>`) plus the few attribute-backed ones, and spread
it into `createTypstEditor`. `setBase` forwards all arguments.

src/typst-editor.ts:132 💡 suggestion — Deep modules
`setBase(base, label?, path?)` puts an optional path behind an optional label, and `base`/`baseLabel` in the
options duplicate it for the main file only. Callers must know the argument order and that only the main file
gets a default.
Fix: `setBase({ text, label?, path? } | null)`, used both in the options and by the method.

src/features/visual-view/visual-view.ts:142 💡 suggestion — Interface comments describe intent, not implementation
The docblock "The source range shown by the selection." sits directly above a second docblock on `focused()`,
and `selection()` itself has none. The comment describes the wrong method.
Fix: move it onto `selection()` (line 148).

## Summary

The building blocks (`TypstDocument`, `Preview`, the engine boundary, `Action`) are deep, and their
shape is already close to CodeMirror. What is missing is the **extension mechanism**. Today a Typst construct
or a widget feature is wired in by naming it in the projection, the schema lists, the box sets, the toolbar,
`VisualViewOptions` and `Widget`. Start with the `TypstNodeSpec` registry for the Visual view: it fixes the
first two blockers and moves margin notes out of the projection. The `Project.replace` notification is a quick
fix and should come first. Keep `TypstExtension` internal until two or three features have been ported to it,
then decide what becomes public.

---

## Addendum A: are members private that can be private?

Method: the TypeScript language service lists every non-private class member and every `export` of
production code under `src/` that has no reference outside its class or file. Every hit was then checked by
hand, because TypeScript is structurally typed: a member called through an interface the class does not name
in `implements` looks unused, but it is not.

**Mostly yes.** The code uses `private` / `#private` consistently. Real misses:

src/features/preview/preview.ts:142 ⚠ should-fix — Deep modules
`Preview.setFollow` is only called inside `Preview` (from its toolbar toggle).
Fix: make it `private`.

src/typst-editor/editing-views.ts:136 ⚠ should-fix — Deep modules
`EditingViews.cursor(document)` has no caller at all, in tests or production. The `Views.cursor` field it reads
(set at `:187`) exists only for it.
Fix: delete both.

src/features/source-view/source-view.ts:148 ⚠ should-fix — Deep modules
`SourceView.setHighlights` and its machinery (`setLayer`, `layersField`, `mapLayers`, `toDecorations`, `:41–60`)
are only exercised by tests. Diagnostics use `setDiagnostics`, and presence has its own extension. Only the
Visual view's `setHighlights` is used, by `markDiagnostics`.
Fix: delete it, or route diagnostics/presence through it so that one mechanism remains.

src/core/typst-document/typst-document.ts:53 💡 suggestion — Deep modules
`TypstDocument.fromYText` is used only by tests. Production code shares through `share(ytext)`. The
interface has two ways to do one thing, and ARCHITECTURE.md documents both.
Fix: delete it; tests use `new TypstDocument('')` + `share(ytext)`.

src/features/changes/changes.ts:130 💡 suggestion — Deep modules
Several members are only called inside their own class (or only by tests):
- `ChangeTracking.show`
- `Layout.choose` and `Layout.isOpen` (`typst-editor/layout.ts:113/134`)
- `FileTree.setExpanded` (`files/tree/tree.ts:105`)
- `FilePanel.element` (`files/files.ts:52`)
- `ToolbarMenu.open`, `close`, `isOpen` and `trigger` (`toolbar/toolbar-menu.ts:13–77`)
- `StyleIndex.styles` and `onChange` (`styles/styles.ts:43/47`; outsiders use them through `forDocument`)

Fix: make them `private`. Where a test needs them, test through the DOM (click the trigger, check
`aria-expanded`), as the e2e specs do.

src/features/visual-view/nodes/heading-numbering.ts:28 💡 suggestion — Information hiding
`HEADING_NUMBERING_RULE` and `referenceQuery` (`references/reference-suggestion.ts:21`) are exported but
used only in their own file.
Fix: drop `export`.

server/src/gitlab/gitlab-room.ts:12 ✋ blocker — Information hiding
The server re-declares `const FILES_MAP = 'files'`, and the client exports the same constant from
`features/collaboration/shared-project.ts:7`. Both sides know the Y.Doc layout, but share no definition. If
one side renames the map, collaboration breaks silently, and no type error points to it.
`GITLAB_ROOM_PREFIX` already shows how to do it right.
Fix: move `FILES_MAP` into the import-free `gitlab-protocol.ts` (or a `room-layout.ts` beside it), and
import it on both sides.

Not findings (verified):
- **ProseMirror NodeViews** (`RawBox`, `CodeBlockView`, `PointNoteMarker`): ProseMirror calls them.
- **`<typst-editor>` properties**: they are the host's API.
- **Members used through structural interfaces:**
  - `Preview.exportPdf` (`PdfEngine`)
  - `VisualView.editNote` (`NoteView`)
  - `SourceView.selection` and `showChanges` (`CurrentSelection`, `ChangeView`)
  - `RoomVersions.*` (`Versions`)
- **Exported option/props types** (`PreviewOptions`, `FileTreeOptions`, …): they type public constructor
  parameters.
- **Exports used only by unit tests** (`cropSvg`, `formatSize`, `parseNoteCall`, `inlinePictureSize`, …):
  exported pure functions so tests can check them directly. That is a reasonable trade-off.

## Addendum B: import graph and cycles

Method: every relative `import`, `export … from` and `import()` of production files under `src/`, resolved with
the TypeScript module resolver. Strongly connected components (Tarjan) were computed at file level and at
module level (`core/x`, `features/x`, `typst-editor`, …). The analysis distinguishes runtime imports,
type-only imports and dynamic imports.

**Result:**
- No runtime cycles between files.
- No cycles between the *top-level* modules (`core/x`, `features/x`), even when type imports are counted.
- **Correction:** when *every folder* counts as a module, there **are** cycles between parent and child
  folders. See Addendum C.

Three **type-only** cycles remain, all inside one folder and all with the same shape: an internal helper
imports a *type* from its folder's entry file, which in turn imports or re-exports the helper.

| Cycle | Edge back to the entry |
|---|---|
| `typst-document.ts` → `y-delta.ts`, `minimal-change.ts` → `typst-document.ts` | `import type { TextChange }` |
| `project.ts` → `path-references.ts` → `paths.ts` → `project.ts` (and `reading-order.ts` → `project.ts`) | `import type { FileContent }`, `ProjectFiles` |
| `typst-engine.ts` → `packages/packages.ts` → `typst-engine.ts` | `import type { CompileResult, Diagnostic, Engine, PdfResult }` |

src/core/project/paths.ts:2 💡 suggestion — Obvious design
The entry file serves both as the folder's façade and as the home of its basic types, so internals depend
"upwards" on the façade. TypeScript erases these imports, so nothing breaks at runtime. But the dependency
direction is muddled: to read `paths.ts` you need `project.ts`, which imports `paths.ts`.
Fix: give the basic types a leaf file that imports nothing from its folder:
- `TextChange` → `core/typst-document/text-change.ts`
- `FileContent` / `ProjectFiles` → `core/project/files.ts`
- the engine result types → `core/typst-engine/results.ts`

Each entry file re-exports its leaf file. Dependencies then point one way only.

Top-level module dependencies (no cycles at this level; `→` = imports from):

```
core/typst-document   → –
core/typst-engine     → –
core/project          → core/typst-document
features/changes      → core/project, core/typst-document
features/collaboration→ core/project, core/typst-document
features/comments     → core/project, core/typst-document
features/files        → core/project, core/typst-document
features/labels       → core/project, core/typst-document
features/source-view  → core/project, core/typst-document
features/styles       → core/project, core/typst-document
features/spreadsheets → core/project
features/preview      → core/project, core/typst-engine
features/diagnostics  → core/typst-engine, features/source-view
features/versions     → features/collaboration, features/visual-view
features/visual-view  → core/project, core/typst-document, features/changes, features/comments,
                        features/labels, features/source-view, features/styles
typst-editor          → everything above
```

The layering is clean: `core` → `features` → `typst-editor`. The one structural smell is **feature →
feature** dependencies. `features/visual-view` imports five other features. This is the graph view of the
first two blockers above: the Visual view knows comments, labels and styles instead of receiving them as
extensions. `versions → visual-view` exists only for `FieldPopover`, and `diagnostics → source-view` only
for `describeDiagnostic`. Both are shared UI or helpers that belong in a lower, feature-neutral place.

To keep it that way, add a cycle check to `mise run quality`. Either use `import-x/no-cycle` in ESLint, or
make the graph script (Tarjan over the TS resolver) a mise task that fails on any runtime cycle or any
module-level cycle.

## Addendum C: cycles between folders (every folder is a module)

Method: as in Addendum B, but with every directory as a module (`features/visual-view/nodes`,
`features/files/tree`, …).

**There are three folder cycles.** All have the same root cause: **a child folder imports a non-entry file
of its parent folder**. The parent folder is two things at once: the composer, whose entry file imports the
children, and the home of shared leaf files that the children need. So the dependencies point both down and
up.

### 1. `features/visual-view` ⇄ `nodes`, `images`, `references`, `toolbar` (runtime, 5 folders)

The cycle is closed by only two parent files:

| Up-edge (child → parent) | What is shared |
|---|---|
| `toolbar/toolbar.ts`, `references/label-tags.ts`, `images/image-tools.ts` → `../field-popover.ts` | `FieldPopover` (also used by `features/versions`) |
| `nodes/raw-box.ts` → `../presence.ts` | `boxCarets` (reads the box-caret decorations) |

Down-edges: `visual-view.ts` imports `nodes`, `toolbar`, `references`, `notes-gutter` and `projection`.

Without these up-edges, the sub-folders form a clean DAG: `toolbar → nodes, images, references`;
`nodes → references, images`; everything → `projection`.

src/features/visual-view/nodes/raw-box.ts:14 ✋ blocker — Information hiding
`raw-box.ts` imports `boxCarets` from the parent's `presence.ts`. Both files must agree on the shape of the
box-caret decoration spec: `presence.ts` writes it, and `raw-box.ts` reads it through a function of the
module that composes it. Changes to presence now touch the box, across a folder boundary that points the
wrong way.
Fix: the decoration spec belongs to the box. Move `BoxCaret` and `boxCarets` into `nodes/` (e.g.
`nodes/box-carets.ts`, exported through `nodes.ts`), and let `presence.ts` import it from there. The
dependency then points down only.

src/features/visual-view/field-popover.ts:1 ⚠ should-fix — General-purpose underneath, special-purpose on top
`FieldPopover` is a general UI element (one text field, Apply / Remove, Escape). It sits in the composer
folder, and three children plus another feature (`features/versions`, which imports the whole
`visual-view` entry for it) depend on it.
Fix: give it a feature-neutral home below every feature, for example `src/ui/field-popover/` (or
`core/ui/`). This also removes the `versions → visual-view` edge from Addendum B.

### 2. `features/files` ⇄ `features/files/tree` (runtime)

`files.ts` → `tree/tree.ts` → `../icons.ts`.

src/features/files/tree/tree.ts:5 💡 suggestion — Obvious design
The tree takes its icons from the parent folder's `icons.ts`, and the parent's entry file composes the tree.
Fix: move `icons.ts` into its own leaf folder (`files/icons/icons.ts`), or into `tree/`, with `files.ts`
taking `filesPanelIcon` from the tree's entry.

### 3. `core/typst-engine` ⇄ `core/typst-engine/packages` (type only)

This is the `CompileResult` / `Engine` type cycle from Addendum B. The leaf `results.ts` fix removes it.

### Why the lint rule lets this through

`eslint-rules/entry-imports.js` says: "only files inside `x/` may import [its internals]". A file in
`x/child/` counts as inside `x/`, so it may import any file of `x/`, including the composer's own helpers.
The rule enforces encapsulation from outside, but says nothing about direction.

eslint-rules/entry-imports.js:5 ⚠ should-fix — Information hiding
Fix: tighten the rule. A file may import (a) files in its own folder, (b) the entry file of a direct or
deeper sub-folder, or (c) the entry file of a folder outside its ancestors. It must not import anything
from an *ancestor* folder. Shared code moves down into a leaf folder. Add the folder-cycle check (every
directory a node, Tarjan; script in this review's method) to `mise run quality`, so that a new up-edge
fails the build.
