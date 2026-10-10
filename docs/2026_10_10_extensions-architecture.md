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
  ui/                    Feature-neutral DOM widgets: FieldPopover, ToolbarMenu, FloatingBar, icons.
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
   through a service one of them provides on the context (below). No cycles between folders.
4. `typst-editor/` imports hosts and extension entry files only.
5. The existing rules stay: imports from outside a folder go to its entry file; no `export *`; no
   re-export of another module's API; entry file inside its folder (no sibling folders).

## The extension API (VS Code vocabulary)

```ts
interface TypstExtension {
  readonly id: string;
  activate(context: ExtensionContext): void;  // registers into context.subscriptions
}

interface ExtensionContext {
  readonly subscriptions: Disposable[];       // disposed on destroy, in reverse order
  readonly project: Project;
  readonly workbench: Workbench;               // registerSidePanel, registerStatusBarItem,
                                               // registerFileView(kind, provider), open(path), …
  readonly visualView: VisualViewContributions;  // registerNode(spec), registerMark(spec),
                                               // registerToolbarItem, registerGutter, registerDecorations
  readonly sourceView: SourceViewContributions;  // registerExtension(cm), registerLinkProvider, …
  readonly preview: PreviewContributions;      // registerToolbarItem, registerPdfVariant, overlays
  readonly services: Services;                 // typed: what one extension provides others
                                               // (LabelIndex, StyleIndex, the current user, …)
}
```

- Contributions are registered **once**, at activation. The hosts apply them to every view they
  create later (views are created lazily per document), so an extension never tracks views.
- Configuration (host options such as `user`, `pdfDownload`, `collaboration`) reaches an extension
  as an argument of its factory in the built-in list: `comments({ user })`.
- Services replace cross-feature imports: `labels` provides `LabelIndex`; the `references`
  contributions read it from `services`. Typed by a registry interface (declaration merging, as VS
  Code does), not by strings.
- Not public API at first. Once it holds, `createTypstEditor({ extensions })` can expose it.

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
| `visual-view` | Tiptap editor; the projection **framework**: segmenting source into blocks, source anchors (`src` / `sep` / `lead` / `trail`), print + minimal change back to the document, sync from the document, `posToSource` / `sourceToPos`; the **raw box** (unmodelled Typst, never rewritten, is the host's fallback, not an extension); paragraph + text (the minimum a document needs); selection, presence target | `TypstNodeSpec` / `TypstMarkSpec` registry (schema node, projector for its syntax / call, printer, label + box flags, node view, keymap, input rules); toolbar items and menus; decorations; side gutters; box renderers |
| `source-view` | CodeMirror bound to a `TypstDocument`, document sync, highlights, presence target | CodeMirror extensions (language, lint, links, colors), link providers |
| `preview` | engine worker + protocol, coalesced compiles, page list (lazy SVG), hit-testing, scroll / reveal | toolbar items, PDF variants, overlays on pages |
| `workbench` | layout (side panels with rail buttons, editing area, preview, status bar), the Visual / Source tabs, file views by kind, extension lifecycle, color scheme | side panels, status bar items, file views, commands |

`BLOCK_CALLS`, `PRINT_BLOCK`, `RAW_TYPES`, `LABELLED_BLOCKS` and `callAtomType` are derived from the
registered specs (review blocker `projection.ts:467`). `projection.ts` imports no feature (blocker
`projection.ts:53`). `VisualViewOptions` goes away (`visual-view.ts:22`). `Widget`'s 20 fields and
`mount*` methods go away (`typst-editor.ts:170`).

## Built-in extensions (first cut of the mapping)

| Extension | Model | Contributions | From today |
|---|---|---|---|
| `markup` | — | Visual: headings, strong / emph, lists, code, quotes, links, raw code; toolbar marks/lists | `visual-view/nodes/*` basics, `projection/raw-code.ts`, `embedded-code.ts` |
| `tables` | — | Visual: table nodes, floating table bar | `nodes.ts` table parts, `toolbar/floating-bar.ts` usage |
| `heading-numbering` | `numbering`, `heading-numbering` | Visual: number gutter, toggle | `nodes/heading-numbers.ts`, `heading-numbering.ts`, `numbering.ts` |
| `alignment` | `alignment` | Visual: `#align` blocks, toolbar Align ▾ | `nodes/text-align.ts`, `projection/alignment.ts` |
| `task-lists` | checklist preamble | Visual: task list nodes | `nodes/task-list.ts`, `checklist-preamble.ts` |
| `page-layout` | — | Visual: page break, horizontal rule (call atoms) | `nodes/page-break.ts`, `horizontal-rule.ts`, `projection/call-atoms.ts` |
| `images` | image call / edits | Visual: image box, tools, insert + drop; Workbench: asset file view | `visual-view/images/*`, `files/asset-view.ts`, `typst-editor/project-renderings.ts` (images part) |
| `rendered-boxes` | — | Visual: box renderer (snippets from the preview) | `nodes/rendered-box.ts`, `preview/pages/snippet.ts`, project-renderings (snippets part) |
| `labels` | `LabelIndex`, `scan` (service) | Visual: reference chip, label tags, `@` suggestions, hints | `features/labels/*`, `visual-view/references/*`, `projection/labels.ts` |
| `styles` | `StyleIndex`, `discover`, `new-style` (service) | Visual: styled block / style mark, style menu | `features/styles/*`, `nodes/styles.ts`, `toolbar/style-menu.ts` |
| `comments` | margin-note syntax, threads, `addMarginNote`, `withoutNotes`, page margin | Visual: margin-note nodes, notes gutter, Comment action; Preview: PDF "without comments" | `features/comments/*`, `nodes/margin-notes.ts`, `visual-view/notes-gutter/*` |
| `document-links` | (core) | Visual: box links; Source: file links | `nodes/box-links.ts`, `source-view/file-links.ts` |
| `typst-language` | — | Source: syntax, colors (also used by raw boxes: a service) | `source-view/typst-language.ts`, `code-colors.ts` |
| `diagnostics` | summary | Source: lint; Visual: highlights; Workbench: status bar | `features/diagnostics/*`, `source-view/lint.ts` |
| `files` | tree model, upload | Workbench: side panel, file navigation (prev / next) | `features/files/*`, `typst-editor/file-navigation.ts` |
| `spreadsheets` | typst-file, workbook | Workbench: `.ic` file view | `features/spreadsheets/*` |
| `pdf-export` | — | Preview: Download PDF menu, variants | `preview/pdf-menu.ts`, `typst-editor/pdf-export.ts` |
| `preview-controls` | zoom | Preview: zoom, follow cursor, page n / total | `preview/toolbar.ts`, `pages/zoom.ts` |
| `collaboration` | shared project / assets, remote cursors, room versions (lazy chunk) | Visual + Source: presence; Workbench: presence dots | `features/collaboration/*`, `typst-editor/collaboration-link.ts`, both views' `presence.ts` |
| `versions` | — | Workbench: Save version | `features/versions/*` |

The mapping is a first cut; the agent that moves a slice may adjust it within these rules and says
so in its report.

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
