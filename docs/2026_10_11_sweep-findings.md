# Conventions sweep: findings that need a decision

**Decided by the user (2026-10-11): all recommendations accepted**, with these precisions:
- A1: one interface, `Disposable { dispose() }`, for everything with a lifetime (ProseMirror NodeViews
  keep `destroy`, the library calls it).
- A4: the Visual view contribution API is **public** — the built-in constructs already are extensions
  using it; outside extensions must be able to do the same (export the spec / grammar / toolbar types,
  an example construct in docs/embedding.md written as if outside the package).
- B: cross-extension schema names can't vanish entirely (ProseMirror's schema is one global object);
  they stay only as data — groups (`figureBody`), configured type lists / spec flags (Tiptap's
  `addGlobalAttributes({ types })`), always guarded (`schema.nodes.x`, `editor.can()`) — and
  contribution points where one extension drives another's UI (text-style menu).
- A6 (changed by the user): **use Tiptap / ProseMirror directly** — no `{ priority }` of our own on
  `registerNode` / `registerMark`; the spec's Tiptap extension `priority` (default 100, higher first)
  is the one knob for schema order, mark nesting, keymaps *and* which projector claims a syntax. Our
  own `priority` stays only where Tiptap has nothing (box renderers, link providers, PDF options,
  custom editors). The wave running at the time builds the opposite; a follow-up replaces it.
- Projection naming (user): spec fields `parseTypst` / `toTypst` (as ProseMirror's `parseDOM` /
  `toDOM`); framework classes `TypstToProseMirrorParser` / `ProseMirrorToTypstSerializer`; what spec
  functions receive: `TypstParseContext` / `TypstSerializeState` (today `ProjectionContext` /
  `Printer`; "projector" / "printer" wording goes). Done in the follow-up, before the types are public.

Eight agents reviewed every area against [the code conventions](2026_10_11_code-conventions.md) on
2026-10-11 and fixed what was clear (about 70 small commits, merged at `c103841`). These are the
findings that change an API across areas or need a decision. Each has a recommendation; the number
of agents that reported it independently is in brackets.

## A. API shape

1. **`destroy()` vs `dispose()`** [6]. Registrations return `Disposable.dispose()`, but views, hosts,
   ui widgets, contributed parts (`Gutter`, `BoxTools`), `Project` and the widget use `destroy()`;
   `DiagramEditor` uses `dispose()`. *Recommendation:* `dispose()` everywhere, the widget handle
   included (VS Code's one verb; the API is unreleased). ProseMirror NodeViews keep `destroy` (their
   library calls it).
2. **Workbench as VS Code namespaces** [2]. `Workbench` has ~40 members, most forwarding to an
   internal class; the entry is ~940 lines. *Recommendation:* `ExtensionContext.commands`, `.window`
   (messages, input box, quick pick, status bar, custom editors, file decorations, active editor),
   `.scm`, `.languages` (document links), `.workspace` (configuration, `applyEdit`), each its own
   `hosts/<name>/` module implementing the namespace directly (no forwarding); `.workbench` keeps the
   frame (open, side panels, editor frame, style sheets, user, drops). Touches ~50 extension files.
3. **Memento instead of `remember` + raw `localStorage`** [2]. preview-sync writes `localStorage`
   (forever, per browser); pdf-export and files use `remember` (session, per widget).
   *Recommendation:* `context.globalState` / `context.workspaceState` (`get(key, default)`,
   `update(key, value)`), scoped by extension id. Follow cursor → global; PDF options, open folders →
   workspace.
4. **Visual view contribution API: public or internal?** [1] `index.ts` exports
   `VisualViewContributions` but not `TypstNodeSpec`, `TypstMarkSpec`, `ToolbarItem`, `BoxRenderer`,
   … so outside extensions can't actually write Visual-view contributions. *Recommendation:* make it
   public after A5, and export the spec types; hide `contributed()` / `from()` (host / tests only)
   behind an interface with only the `register…` methods.
5. **`hosts/projection` owns the minimum schema** [1]. Paragraph, raw block/inline, soft break, the
   `typstSource` mark, `createSchema` live in visual-view's `nodes.ts`, so the projection can't be
   tested alone (its test sits in visual-view) and the visual-view entry has a load-order cycle.
   *Recommendation:* move the schema half of `nodes.ts` + `starterKitPart` into `hosts/projection`
   (the Visual view's document model), the projection test with it.
6. **Two priority systems for marks** [1]. `registerMark(…, { priority })` sorts specs, but Tiptap
   re-sorts by each extension's own `priority` (Link 1000, margin notes 1001, styles 900), so our
   documented nesting does not hold. *Recommendation:* the host copies the registered priority onto
   the spec's Tiptap extension; comments and styles use `registerMark(…, { priority })`.
7. **New-file prompts copied three times** [1] (new file, spreadsheet, diagram). *Recommendation:*
   VS Code's `window.showSaveDialog({ title, defaultUri, filters, saveLabel }) → ProjectPath |
   undefined` (refuses existing names).
8. **File icons** [1]: the files extension knows `.ic`, `.drawio.png`, image endings.
   *Recommendation:* an optional `icon` on `registerCustomEditorProvider`; the panel asks the
   workbench.
9. **Source control status as a news channel** [1] (`state.status` compared by identity).
   *Recommendation:* the provider (collaboration) shows its own messages via `show…Message`;
   `SourceControl.state` keeps only `busy`.
10. **`exportPdf` shortcut** [1]: `exportPdf({ options: {…} })` + a `PdfExportOptions` type next to
    `PdfExportOption`. *Recommendation:* `exportPdf(options?: Record<string, boolean>)`, drop the
    wrapper type; document it as the one feature shortcut on the widget handle.
11. **Extensions as constants vs factories** [1] (`markup` vs `images()`). *Recommendation:* factories
    everywhere (`markup()`), so options can come later without a break.
12. **`createOverlay` / `PageOverlay` has no user** [1]. *Recommendation:* remove from the public API
    (keep it internal to the preview) — "remove what does not work".
13. **Side panel order** [1]: rail buttons in registration order. *Recommendation:* `{ order }` on
    `SidePanelOptions`.

## B. Extensions still coupled at runtime

Imports are clean, but schema names and commands still couple extensions [2]:
- styles drives headings' commands for "Normal text / Heading 1–3"; *recommendation:* a text-style
  menu contribution point; headings registers its levels, styles its custom styles.
- figures (in images) name the tables' node and style `.typst-visual__table`; *recommendation:* a
  node group `figureBody` both specs join; table-in-figure CSS moves to tables. Decide: figures stay
  in `images`, or become a `figures` extension (recommended: `figures`).
- alignment / tables read each other's node names and attributes; *recommendation:* a host spec flag
  ("children may be wrapped by alignment") and the rule "reading another extension's schema name
  must be guarded", added to the conventions.
- collaboration's CSS names page-layout's class; *recommendation:* a generic attribute the host puts
  on boxes that can't take a flag.

## C. CSS ownership and class names [3]

`typst-editor.css` still holds the preview host's, the Visual view toolbar's, raw boxes', the tab
bar's, `FloatingBar`'s and `PopupMenu`'s rules; extensions style hosts' classes (`typst-preview__pdf*`,
`typst-visual__table`, `.typst-visual h1`, `typst-editor__file-nav*`). *Recommendation:* every host
and `ui/` module brings its own `<name>.css` (the workbench registers the hosts'); `typst-editor.css`
keeps only tokens and the frame; extensions get class names of their own
(`typst-pdf-export__…`), renamed together with the e2e specs.

## D. Layers and placement

- `ui/color-scheme` has no DOM → `core/color-scheme` [1]. *Recommendation:* yes.
- `ToolbarMenu`, `FloatingBar` have one user each (the Visual view toolbar) → into
  `hosts/visual-view/toolbar/` [1]. *Recommendation:* yes; `ui/` keeps `PopupMenu`.
- Shared DTOs duplicated because `model/` may not import hosts (`User` ×3, `SourceControlState` ×2)
  [1]. *Recommendation:* such plain shapes live in `core/` (e.g. `core/user`), not in host entries.
- `fileNavigation` is a second extension inside `files` → own `extensions/file-navigation/` [1].
- `headings.toggleNumbering` has no UI (meant for an inspector that doesn't exist) [1].
  *Recommendation:* register it as a command (reachable by hosts / a future menu), stop exporting
  three functions only tests use.
- `testing/` uses entry exports made only for it (`imagesVisualView`, `renderedBoxesVisualView` and
  their option types) [2]. *Recommendation:* `testing/` activates the real `images()` /
  `renderedBoxes()` with a fake `ExtensionContext`; those exports go.

## E. Value types (the planned last wave) [5]

`SourceOffset` / `SourceRange` vs ProseMirror positions (highlights, reveal, selections, links,
notes, styles); `PageIndex`, `Pt` / `Px`; `reveal(path: ProjectPath)`; `Diagnostic.path` parsed to
`ProjectPath | null` at the engine edge; `ProjectPath.name(path)` (hand-written ×3);
`FileContent.bytes(content)` (×4).

## F. Small ones

`ClientMessage` / `ServerMessage` use `type` (wire protocol; *recommendation:* exempt wire messages
from the `kind` rule); `ProjectPath.fromName` → a `kind` union; `core/gitlab-protocol` →
`core/room-protocol` (its maps describe every room); `PackageProject` → `PackageEngine`; a `.typ` file
given as bytes throws everywhere; a named origin constant instead of `'api'`; Mod+K as a keymap;
`server/src/gitlab/http.ts` → `server/src/http.ts`; drop the demo's legacy `?files` URL;
`src/index.test.ts` timeout 20 s (flaky under load); `PreviewContributions` name (also carries reveal,
snippet, exportPdf).

## G. Corrections to the conventions doc (all agents agree)

- §6 tests: "through the exported interface of the unit under test (an entry, or a file inside the
  module); no member exists only for tests" — not "of their module".
- §2: when a concept becomes its own module (its types + class form an API of their own), so entries
  don't grow into 1000-line type collections; internals may use their entry's values at runtime,
  never while modules load.
- §3: `testing/` uses every module's *entry*; `ui/` uses only `core/` (enforced; say if widgets may
  compose); a host folder may be a host's model module without contribution points
  (`hosts/projection`).
- §4: the disposal verb (A1); events that take an argument (`onDidChangeGrammar(schema, listener)`);
  priority vs Tiptap's priority (A6); registration order counts within one extension, never between
  extensions; documented command shortcuts on the widget (A10); "extensions never depend on each
  other" includes runtime schema names and commands (B).
- §5: which edge parses engine results (the preview / engine boundary); a `kind` union is
  `{ kind, … }`, wire messages exempt.
- §6: decision records ("decided 2026-10-10") in ARCHITECTURE.md are allowed; history in code
  comments is not.
