# Extensions architecture: small hosts, everything else an extension

Target architecture for branch `task/api-extensibility`, decided 2026-10-10. It replaces the old
"step 2" of [the refactoring plan](2026_10_10_refactoring-plan.md) (its review findings are folded
in below) and answers two questions the user raised:

- *Which part of a feature is model and which is view?* Today you can't tell. Features are cut by
  the editor that shows them, not by concept: the labels model is in `features/labels/` and its UI in
  `features/visual-view/references/`; the styles model is in `features/styles/` and its UI in
  `visual-view/toolbar/style-menu.ts` + `visual-view/nodes/styles.ts`; the comments model is in
  `features/comments/` and its UI in `visual-view/nodes/margin-notes.ts` + `visual-view/notes-gutter/`.
  `projection.ts` imports `features/comments`, and `VisualViewOptions` and `Widget` list every
  feature by name.
- *Do as much as possible in extensions.* The editors become small hosts that offer
  contribution points. Every feature is an extension, and so is every Typst construct beyond the
  host's minimum, with the built-ins shipped as a default list (like Tiptap's StarterKit or VS Code's
  built-in extensions).

## Layers

```
src/
  core/                  MODEL. Project, TypstDocument, paths, document-links, typst-engine.
                         No DOM; no ProseMirror / CodeMirror / Tiptap. Tests run in node.
  ui/                    Feature-neutral DOM widgets: PopupMenu, ToolbarMenu, FloatingBar, icons.
  hosts/                 VIEW HOSTS: mechanism + contribution points, no feature knowledge.
    visual-view/         Tiptap editor over the projection *framework*
    source-view/         CodeMirror bound to a TypstDocument
    preview/             engine worker, page list, hit-testing, scrolling
    workbench/           the widget's frame: layout slots, file views, extension lifecycle
  extensions/<name>/     One vertical slice per concept (was features/):
    <name>.ts            entry: `export const <name>: TypstExtension` (activate → disposables)
    model/               pure: read models, parsing, `calculate…` commands. No DOM.
    visual-view/         what it contributes to the Visual view (node specs, toolbar items, gutters)
    source-view/         … to the Source view
    preview/             … to the preview
    workbench/           … to the frame (side panel, status bar item, file view)
  typst-editor/          createTypstEditor: the public API, the built-in extension list, options →
                         extension configuration. typst-editor.ts + .css inside the folder.
  typst-editor-element/  <typst-editor>, entry inside the folder.
  testing/               test helpers composing the built-in extensions (testing.ts); only *.test.ts import it.
  index.ts               package entry.
```

`core` = Model, `hosts` + an extension's view folders = View, an extension's entry (`activate`) =
Controller: it subscribes views to the model's `onChange` and turns user input into commands
(`FileChange`, `TextChange`). Pure presentation logic (`tree-model`, `geometry`, `card-layout`,
`numbering`) is `model/`: the line between the layers is the DOM.

### Dependency rules (ESLint, part of `mise run quality`)

1. `core/**` and every `**/model/**`: no DOM globals, no editor-library imports.
2. `hosts/**` never import `extensions/**` (nor `typst-editor/`). They only offer contribution points.
3. `extensions/<a>` never imports `extensions/<b>`. Extensions meet through `core` models, or
   through a generic contribution point of a host that any extension may use (document links, file
   decorations, source controls; no services). No cycles between folders.
4. `typst-editor/` imports hosts and extension entry files only.
5. The existing rules stay: imports from outside a folder go to its entry file; no `export *`; no
   re-export of another module's API; entry file inside its folder (no sibling folders).

## The extension API (VS Code vocabulary)

```ts
interface TypstExtension {
  readonly id: string;
  readonly contributes?: { configuration?: { properties: Record<string, ConfigurationProperty> } };  // its settings
  activate(context: ExtensionContext): void;  // registers into context.subscriptions
}

interface ExtensionContext {
  readonly subscriptions: Disposable[];       // disposed on destroy, in reverse order
  readonly project: Project;
  readonly workspace: Workspace;               // getConfiguration('<section>').get('<key>'), onDidChangeConfiguration
  readonly workbench: Workbench;               // registerSidePanel, registerStatusBarItem,
                                               // registerCustomEditorProvider(viewType, provider,
                                               //   { filenamePattern, priority }), open(path), …
  readonly visualView: VisualViewContributions;  // registerNode(spec), registerMark(spec),
                                               // registerToolbarItem, registerGutter, registerDecorations
  readonly sourceView: SourceViewContributions;  // registerExtension(cm)
  readonly preview: PreviewContributions;      // registerToolbarItem, registerPdfExportOption, overlays, reveal,
                                               // onDidClickPage
}
```

- Contributions are registered **once**, at activation. The hosts apply them to every view they
  create later (views are created lazily per document), so an extension never tracks views.
- Configuration (as built, 2026-10-10): what a feature lets hosts configure is a setting its extension declares
  (`contributes.configuration`, VS Code's shape: `pdfExport.download`, `files.panel`, `previewSync.followCursor`;
  the workbench's own `workbench.theme`), set by the host (`createTypstEditor({ settings })`, `editor.settings`,
  `<typst-editor settings='{…}'>`) and read with `workspace.getConfiguration`, following `onDidChangeConfiguration`.
  `user` is a widget option every extension reads as `Workbench.user`; `collaboration` takes the host's connection
  as its factory's argument and is added by the host.
- No services (decided 2026-10-10): what one extension has for another goes through a generic contribution
  point of a host, VS Code's shapes: `workbench.registerDocumentLinkProvider` (read by both views and by
  `images`), `registerFileDecorationProvider` (collaboration's presence, shown by `files`),
  `registerSourceControl` (the GitLab room, shown by `source-control`). A feature's own contributions get its
  models directly (`labels` hands its `LabelIndex` to `references`).
- Public (2026-10-10): `createTypstEditor({ extensions: (builtins) => [...builtins, mine] })`; the types are
  exported from `src/index.ts`. Commands are plain string ids, `executeCommand<T>(id, ...args): Promise<T>`.

### Priority: who wins when two contributions claim the same thing

Registration order never carries meaning. Where contributions compete, the API has an explicit,
documented tie-breaker, taken from the libraries underneath (decided 2026-10-10):

| Contribution | Tie-breaker | Model |
|---|---|---|
| `registerNode` / `registerMark` (projector claims a syntax or call; schema order; mark nesting) | `priority?: number`, default 100, higher first; equal → registration order | Tiptap's extension `priority` (same number, same direction); ProseMirror parse-rule `priority` |
| `registerBoxRenderer` (which renderer draws a raw box) | `priority?: number`, as above | Tiptap; VS Code providers ranked by `score` |
| Toolbar items / menus, preview toolbar items | `group` + `order` | VS Code menus (`"navigation@1"`) |
| Status bar items | `alignment` + `priority` | VS Code `StatusBarItem` |
| Source-view extensions | CodeMirror's own `Prec.highest … lowest` (passed through, nothing of ours) | CodeMirror 6 |

The built-ins use it: task lists `priority: 110` over lists, the image box renderer `110` over
rendered snippets. Priority is part of each contribution point's docblock and of the public
extension API once that is exposed (`createTypstEditor({ extensions })`).

## What stays in each host

| Host | Mechanism it keeps | Contribution points |
|---|---|---|
| `visual-view` | Tiptap editor; the projection **framework**: segmenting source into blocks, source anchors (`src` / `sep` / `lead` / `trail`), print + minimal change back to the document, sync from the document, `posToSource` / `sourceToPos`; the **raw box** (unmodelled Typst, never rewritten, is the host's fallback, not an extension); paragraph + text (the minimum a document needs); selection; the view context's position map | `TypstNodeSpec` / `TypstMarkSpec` registry (schema node, projector for its syntax / call, printer, label + box flags, node view, keymap, input rules); toolbar items and menus; decorations; side gutters; box renderers; box actions |
| `source-view` | CodeMirror bound to a `TypstDocument`, document sync, the reveal highlight | CodeMirror extensions (language, lint, colors, other users' carets) |
| `preview` | engine worker + protocol, coalesced compiles, page list (lazy SVG), hit-testing (`onDidClickPage`), scroll / `reveal` | toolbar items, PDF export options, overlays on pages |
| `workbench` | layout (side panels with rail buttons, editing area, preview, status bar), the Visual / Source tabs, custom editors by file name pattern + priority, extension lifecycle, color scheme; showing document links in the Source views and raw boxes | side panels, status bar items, custom editors, commands, menus, document link providers, file decoration providers, source controls |

`BLOCK_CALLS`, `PRINT_BLOCK`, `RAW_TYPES`, `LABELLED_BLOCKS` and `callAtomType` are derived from the
registered specs (review blocker `projection.ts:467`). `projection.ts` imports no feature (blocker
`projection.ts:53`). `VisualViewOptions` goes away (`visual-view.ts:22`). `Widget`'s 20 fields and
`mount*` methods go away (`typst-editor.ts:170`).

## Built-in extensions (as built)

The result of the slices and the clean-up (2026-10-10). Every extension is `src/extensions/<name>/` with its entry
`<name>.ts`; "CSS" means it has `<name>.css`, imported `?inline` and added with `workbench.registerStyleSheet` on
activation. The widget's list (`typst-editor/typst-editor.ts`, `builtinExtensions`) carries no order between the
Visual view's contributions: `priority` decides (task lists 110 over bullet lists, the image box renderer 110 over
snippets), toolbar items (the preview's too) have `group` + `order`; the order only places tab bar and status bar
items.

| Extension (id) | `model/` | Contributions | Commands | CSS |
|---|---|---|---|---|
| `typstLanguage()` (`typst-language`) | — | Source: Typst syntax + code colors; Visual: the same in raw boxes (`registerBoxCodeExtension`) | — | — |
| `documentLinks()` (`document-links`) | (core `document-links`: `findFilePaths`) | Workbench: a `DocumentLinkProvider` (the views show its links) | command `documentLinks.createFile` | — |
| `collaboration(options)` (added by the host, not a built-in) | `SharedProject`, `SharedAssets`, `RemoteCursors`, `GitLabSourceControl` (lazy chunk; protocol in core `gitlab-protocol`); `presence/` (eager) | Source + Visual: other users' carets and selections (also in raw boxes); Workbench: file decorations, the GitLab room's source control | — | yes |
| `files()`, `fileNavigation()` (`files`, `file-navigation`) | tree model (uploads: core `uploads`) | Setting `files.panel`; Workbench: file panel (side panel, file decorations of any provider), drops; editor frame "← previous / next file →" | — | yes (`files.css`) |
| `spreadsheets()` | `typst-file` (`name.ic.gen.typ`) | Workbench: custom editor `spreadsheets.editor` for `*.ic` (IronCalc, loaded on demand), "New spreadsheet…" in `file/newFile` | command `spreadsheets.newSpreadsheet` | yes |
| `diagrams()` | `EmbedSession` (embed protocol), PNG round trip, empty diagram | Setting `diagrams.editorUrl`; Workbench: custom editor `diagrams.editor` for `*.drawio.png` (priority 110), "New diagram…" in `file/newFile`; Visual: box action "Edit diagram" | command `diagrams.newDiagram` | yes |
| `diagnostics()` | `DiagnosticCollection`, summary | Source: lint; Visual: highlights; Workbench: status bar item | — | yes |
| `sourceControl()` (`source-control`) | — | Workbench: "Save to <label>…" in the tab bar for every registered source control | — | — |
| `markup` | raw code (code delimiters) | Visual: strong, emphasis, links, inline code, code blocks, block quotes; selection bar, Insert items | — | yes |
| `headings` | numbering patterns, `HeadingCounter` | Visual: headings, their numbers (editor extension) | — | yes |
| `tables` | `TableLayout` | Visual: `#table(..)`, Insert table, the table bar | — | yes |
| `images()` | image call edits, `uploadTarget` | Visual: image boxes + figures (the path as its document link), tools, Insert image, drops; box renderer (110); Workbench: custom editors `images.preview` (images) and `images.file` (`*`) | — | yes |
| `renderedBoxes()` (`rendered-boxes`) | `Snippet`, sizes | Visual: box renderer (compiled snippets from the preview) | — | — |
| `outline` | — | Visual: `#outline(..)` as a labelled box, Insert table of contents | — | — |
| `pageLayout` (`page-layout`) | — | Visual: page break, horizontal rule | — | yes |
| `lists` | cheq's preamble | Visual: bulleted, numbered and task lists (task lists 110), list buttons | — | yes |
| `alignment` | alignment syntax | Visual: `#align` blocks, justified paragraphs, Align menu | — | — |
| `comments()` (signs as `Workbench.user`) | margin-note syntax, threads, `addMarginNote`, `withoutNotes`, page margin, card layout | Visual: margin notes, notes gutter, Comment action; Workbench: Comment button (Source tab bar), Mod+Alt+M; Preview: PDF export option `comments.include` | command `comments.addComment` | yes |
| `labels()` | `LabelIndex`, scan, reference syntax, label choices | Visual: reference chips + hints, label tags, `@` list, Add label | — | yes |
| `styles()` | `StyleIndex`, discover, `newStyle` | Visual: styled blocks, text styles, the style menu; "New style…" | — | yes |
| `previewSync()` (`preview-sync`) | — | Setting `previewSync.followCursor`; Preview: Follow cursor (reveal on selection), click → source | — | yes |
| `previewControls()` (`preview-controls`) | zoom | Preview: zoom, page n / total | — | yes |
| `pdfExport()` (`pdf-export`) | — | Setting `pdfExport.download`; Preview: Download PDF + options popover (remembered per viewer) | command `pdfExport.export` | yes |

Not extensions: the hosts' minimum (Visual view: paragraphs, text, raw boxes; the hosts' toolbar, highlights;
the workbench's document links) and its CSS (`typst-editor.css` with the color tokens, `hosts/visual-view/visual-view.css`,
`hosts/workbench/layout/layout.css`). Shared code is core: `core/uploads` (files from the computer as `create`
changes), `core/gitlab-protocol` (import-free, also the server's). Test helpers composing the built-ins live in
`src/testing/` (only `*.test.ts` import it); hosts import neither `extensions/` nor `testing/`, also not in tests.

## Order of work (subagents; the main agent merges and checks)

1. **Hosts first, in parallel** (worktrees; each keeps today's features working by registering them
   through the new points from where they are now):
   - *H1 visual-view*: `TypstNodeSpec` / mark / toolbar / gutter / decoration registries; projection
     framework derives its tables from them; `VisualViewOptions` gone.
   - *H2 source-view + preview*: their contribution points; `Preview.setFollow`,
     `SourceView.setHighlights` layers made private or routed through the points.
   - *H3 workbench + extension API*: `TypstExtension`, `ExtensionContext`, `Disposable`, services;
     layout slots, file views by kind, `typst-editor/` and `typst-editor-element/` folders,
     `Widget` composing a list. Defines the context with typed slots for H1 / H2's contribution
     interfaces (the main agent wires them together at merge).
2. **Slices, in parallel** (one agent per group of extensions from the table, moving code into
   `extensions/<name>/{model,visual-view,…}` and deleting the old wiring): (labels, styles), (comments),
   (markup, tables, alignment, task-lists, page-layout, heading-numbering), (images, rendered-boxes,
   document-links), (files, spreadsheets, versions, pdf-export, preview-controls),
   (collaboration, diagnostics, typst-language). The old review leftovers go with their slice:
   Addendum A privatizations, `FILES_MAP` via `gitlab-protocol.ts` (collaboration), leaf files for
   `FileContent` / `ProjectFiles` / engine result types (core, done by the main agent before), `FieldPopover`
   / `ToolbarMenu` into `ui/`.
3. **Rules**: the ESLint layer rules above, a folder-cycle check, no `export *` / re-exports; fix
   what they flag. ARCHITECTURE.md rewritten for the new layout.
4. **Value types**: `SourceOffset` vs `DocPosition`; `PageIndex`, `Pt` / `Px`.
5. **Conventions doc + sweep** (step 3 of the refactoring plan).
