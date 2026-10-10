# Spike: dockview as the widget's docking mechanism?

Date: 2026-10-10. Branch `spike/dockview`. Question from
[todo/inspector-sidebar.md](todo/inspector-sidebar.md), decision 3: should the widget use
[dockview](https://dockview.dev) for its layout, with the panels Visual/Source, Preview, Notes,
Inspector, Files and perhaps Diagnostics?

## Recommendation: adopt later, not now

Build the Notes | Inspector side panel by hand, behind a small `Layout` module whose interface
already has dockview's shape: panel ids, show/activate, a serialisable layout, host options.
Switch that module's inside to dockview once there is a concrete need for user-arranged layouts
(drag panels around, float or pop out the preview onto a second screen, several open files side by
side). The switch then stays inside one module.

Why not now:
- **The need today is small.** Three columns plus one tab strip (Notes | Inspector) is about 150
  lines of DOM and CSS grid with one splitter. Dockview would add 88 KB gzip of JavaScript, which is
  +23 % on our main module, for features nobody has asked for yet.
- **Shadow DOM support is two weeks old.** Our `<typst-editor>` element renders into a shadow
  root. Dockview fixed five shadow-root bugs (focus, drag ghosts, touch drag & drop, context menu,
  unstyled popouts) in 8.4.0, released 2026-09-30. Before that it did not work properly in a shadow root.
- **The licence model is moving.** The core is MIT. Since July 2026 there is also a paid
  `dockview-enterprise` package, and it holds the very features an editor widget would want next:
  keyboard navigation between groups (F6), auto-hide edge groups (a VS Code style collapsible side
  bar), and layout undo. Major versions also come fast: 7.0 in July 2026, 8.0 in August 2026.
- **The hard parts stay ours.** Dockview has no responsive collapse for narrow embeds, and our
  views (CodeMirror, ProseMirror, the preview) need care when it detaches or moves their DOM.

Why it is a good candidate later: MIT core with no paid features needed for our use; it runs in a
shadow root (it hit-tests through the root and copies the root's styles into popouts); a clean
vanilla TypeScript API; `toJSON`/`fromJSON`; `locked` and `disableDnd`; and theming through CSS
variables that map well onto our `--te-*` tokens. The jsdom test on this branch passes.

## 1. Licence

- `dockview` 8.4.1 and `dockview-core` 8.4.1 are **MIT** (`LICENCE.md` in both packages,
  copyright mathuo). They have no dependencies.
- In v8 the installable package is **`dockview`** for vanilla TypeScript. It is a pure re-export
  that also ships `dist/styles/dockview.css`. The `dockview-core` README says: *"Internal core layout
  engine. Not a supported install target."* We would depend on `dockview`.
- **Paid:** `dockview-enterprise` (first published 2026-07-03, proprietary, licensed per developer
  per year, 30-day trial, no public price). Its modules, named in core's `ENTERPRISE_MODULE_NAMES`:
  AdvancedOverflow (search and MRU in the tab dropdown), AutoEdgeGroup (dock to an edge),
  AutoHideEdgeGroup (pinnable tool windows), DndCompass, KeyboardDocking, **KeyboardNavigation**
  (F6 / Ctrl+] between groups and tabs), LayoutHistory (undo), MultiRowTabs, PinnedTabs and
  SmartGuides. Core logs a "module not registered" error when an option needs one of them.
- **Free, and everything we need:** grid, groups, tabs, drag & drop (HTML5 and pointer/touch),
  floating groups, popout windows, maximise, edge groups (without auto-hide), serialisation,
  locking, theming, ARIA tabs and live-region announcements.
- Risk: the website's licence page promises nothing about what stays MIT, and features have
  already moved into the paid package. Pin exact versions and keep dockview behind one module.

## 2. Bundle size

A tiny entry built with the repo's vite 8.3.4 (`import { DockviewComponent } from 'dockview'` and
mount one component), plus the stylesheet imported `?inline` as we do with our own CSS:

| Part | raw (minified) | gzip |
|---|---|---|
| JS, `DockviewComponent` only | 397 KB | **88 KB** |
| `dockview.css`, as shipped | 124 KB | 10.5 KB |
| …only the base rules (no built-in themes) | 47 KB | 5.9 KB |
| For comparison: our `typst-editor.js` today | 1,389 KB | 379 KB |
| For comparison: `typst_engine_bg.wasm` | 21 MB | 8.4 MB |

Tree-shaking barely helps: importing only the component still pulls in floating groups, popouts,
tab groups, context menus and so on (the whole package `.min.js` is 380 KB). Measured against the
wasm, it adds ~1 % to the download. Measured against our JS, it adds +23 %. The CSS ships 18
themes in 95 KB, so we would strip them with a build step or a CSS `@import` of the base layer only,
which is not offered and would be our own extraction.

## 3. Shadow DOM

Read in `dockview-core/dist/package/main.esm.mjs` (8.4.1) and the GitHub issues:

- **CSS is not injected.** Core ships no CSS, and `dockview` ships `dist/styles/dockview.css`. We
  would add it to our existing `<style id="typst-editor-styles">` in the shadow root
  (`injectStyles` in `typst-editor.ts`), with `?inline` as for `styles.css`. Nothing goes into
  `document.head`, which the test checks.
- **Hit-testing and drag & drop:** `getHitTestRoot(node)` uses the shadow root's
  `elementsFromPoint`, and `isEventWithin` uses `composedPath()`. Drag ghosts and overlays go to
  `getOverlayParent(node)`, which is the shadow root when there is one, so our styles apply.
  Pointer drags listen on the panel's `ownerDocument.defaultView` (pointermove, pointerup,
  pointercancel). These events cross shadow boundaries and use coordinates, so that is fine.
- **Focus:** `getActiveElement(node)` reads `getRootNode().activeElement`, not
  `document.activeElement`. The theme lookup walks up through `root.host`.
- **Popouts:** `PopoutWindow` copies `document.styleSheets` and also the `styleSheets` and
  `adoptedStyleSheets` of every shadow root around the dock (`styleRoot: () =>
  element.getRootNode()`, PR #1654). It copies once, when the window loads. CodeMirror adds style
  modules later, and those would be missing in the popout.
- **Issues ("shadow"):** #425/#426 (2024, resizing inside a shadow root, fixed in 1.9). #774 (2025,
  drag & drop with iframe panels inside a shadow DOM, closed). In September 2026 a Lit user's report
  (#1649, context menu) led to PRs #1651, #1653, #1654, #1655 and #1657: context menu clicks, touch
  drag & drop, unstyled popouts, focus state and drag ghosts, plus #1656 for the enterprise keyboard
  modules. All were merged on 2026-09-24 and released in **8.4.0 (2026-09-30)**. The support is real,
  but it is new.
- **jsdom test** (`src/layout/dockview-spike.test.ts`, 8 tests, passing). It mounts a
  `DockviewComponent` in an open shadow root with the shipped CSS and checks:
  - groups, tabs and panel content are inside the shadow root, and nothing reaches `document.body`
    or `document.head`;
  - moving a panel into another group as a tab does **not** call `createComponent` again (the same
    element is reused);
  - with the default renderer, a hidden tab's element is detached and re-attached when shown;
    `renderer: 'always'` keeps it connected;
  - remove a panel (its group goes away too);
  - `toJSON` → `JSON.stringify` → `fromJSON` into a fresh component gives the same panels and groups;
  - `locked` + `disableDnd` remove `draggable` from the tabs, and `updateOptions` turns both back on;
  - `dispose` leaves our container in place.

  jsdom cannot check sizes, sashes or real drag & drop. `demo/dockview.html` (spike page, not linked
  from the demo bar) mounts the same setup in a shadow root, with lock, save/restore, reset and
  narrow buttons, for a manual check in a browser (`mise run dev`, then `/dockview.html`).

## 4. Theming, small widths, persistence, locking

- **Theming:** a theme is `{ name, className, colorScheme?, gap?, … }` plus CSS that sets about 60
  `--dv-*` variables on that class. Our theme would be `.dockview-theme-te`, which maps
  `--dv-separator-border`, `--dv-tab-divider-color` → `var(--te-border)`,
  `--dv-active-sash-color` and `--dv-drag-over-border-color` → `var(--te-accent)`, the tab
  colours and the header height (30px, to match our tab strip) and `--dv-overlay-z-index` (below our
  popovers). See `demo/dockview.ts`. Since 8.4 there are also "variables-only" themes (#1660).
- **Small widths:** **no responsive collapse is built in.** It does offer group `minimumWidth` /
  `maximumWidth` constraints, `maximizeGroup`, edge groups that collapse to a strip (the
  auto-hide/peek behaviour is paid), and `hideHeader` per group. A narrow mode would be ours: a
  ResizeObserver on the host, and below a breakpoint all panels move into one group as tabs
  (`narrowLayout` in the demo, 3 lines) or a separate "narrow" layout JSON is loaded. We need the
  same logic without dockview.
- **Persistence:** `api.toJSON()` returns plain JSON (the grid tree, groups with panel ids, active
  panel, floating groups, popouts, edge groups). `fromJSON(data, { reuseExistingPanels })` restores
  it. Panel content is ours: `createComponent({ id })` maps ids to our existing views. Persistence
  belongs to the host (an `onLayoutChange(json)` / `layout` option pair), never to dockview's
  storage. Saved layouts must be validated against the panels that exist now (e.g. no Notes panel
  without notes support). `fromJSON` asks `createComponent` for every panel in the JSON, so the
  Layout module filters the JSON to known panel ids first and falls back to the default arrangement
  if that fails.
- **Locking:** `locked: true` (no drop targets, fixed groups) and `disableDnd: true` (tabs not
  draggable), both changeable at runtime with `updateOptions`, per group `locked` too.
  `disableFloatingGroups`. Popouts happen only through the API or the tab context menu
  (`getTabContextMenuItems`), so we leave them out. A host option `layout: 'fixed' | 'dockable'`
  maps onto this directly.

## 5. How our layout would map

Today (`typst-editor.ts`, `styles.css`): `.typst-editor` is a CSS grid with
`columns: editing | preview` and `rows: 1fr | auto`. Left column: file bar (`FileSwitcher`,
optional) → Visual/Source tabs with tab actions (Comment, Save version) → the shown
file's views or the `AssetView`. Right column: `Preview` with its toolbar. Row 2: the
`DiagnosticsStatus` status bar across both columns.

With dockview:

| Today | Dockview | Notes |
|---|---|---|
| grid row 1 | the `DockviewComponent` | grid row 2 stays |
| status bar | **outside**, grid row 2 | global, not a panel |
| Visual/Source tabs + tab actions | `editor` panel, a single panel | keep our own mode tabs and actions in it. Two dockview panels `visual` and `source` would give side-by-side Visual + Source (the views exist per document already), but the tab actions follow the shown view, and the mode toggle is a single decision today |
| file bar | stays inside the `editor` panel | or, later, one panel per open file (`file:/chapter.typ`), dockview's natural editor-tab model, replacing FileSwitcher's tabs |
| preview | `preview` panel | its toolbar stays inside |
| — | `notes`, `inspector` panels, tabs of one group right of the editor | the new side panel |
| — | `diagnostics` panel (optional) | a list. The status bar summary stays |

The preview toolbar, the Visual toolbar, popovers and the image upload drop handling stay inside
their panels. Popovers must not be clipped by the panel's `overflow: hidden`. Today they are
positioned within `.typst-editor__left`, which also clips, so this changes little, but floating
groups add a z-index layer (`--dv-overlay-z-index`).

Views need two hooks from the Layout: **shown** (CodeMirror `requestMeasure`, ProseMirror
coordinates, the preview's visible-page tracking) and **resized** (dockview gives `onDidDimensionsChange`
per panel). With the default renderer a hidden tab's DOM is detached. That suits Notes/Inspector,
but for editors we would use `renderer: 'always'`, which keeps them in an absolutely positioned
overlay container that follows the group's box.

## 6. Risks and effort

Risks (with dockview):
1. **Young shadow-root support** (8.4.0, 2026-09-30). Real-browser checks are needed for HTML5
   drag between groups, sashes, the tab overflow dropdown and the context menu inside
   `<typst-editor>` (spike page plus Playwright). We cannot run them in this sandbox.
2. **Open-core drift:** free features may move into `dockview-enterprise`, and keyboard navigation
   between groups is already paid. We would build basic F6 group cycling ourselves for accessibility.
3. **Churn:** two major versions in two months. Exact pins and one wrapper module limit the damage.
4. **Moving DOM vs. our editors:** detaching/re-attaching CodeMirror and ProseMirror (tab
   switch), and popouts moving them into another `document` (CodeMirror's `root` option, our
   `injectStyles` target, object URLs, ResizeObservers). Popouts stay off.
5. **Drag & drop overlap:** dockview's drop targets also see external file drags. A foreign drag
   shows an overlay only if an `onUnhandledDragOver` listener accepts it (`canDisplayOverlay`), and
   dockview stops propagation only for its own drops (`Droptarget`), but
   our FileSwitcher widget-wide drop and the Visual view's image drop need a browser check.
6. **Size:** +88 KB gzip JS, +6 KB CSS after stripping themes.
7. **Narrow embeds:** our own logic either way.

Effort estimate:
- **Hand-built `Layout` (recommended now):** grid with editor | side panel (tabs Notes |
  Inspector, collapsible, one splitter) | preview, narrow mode, host options `panels`/`layout`,
  persistence callback. About **1.5–2 days** including vitest and a Playwright spec.
- **Dockview behind the same `Layout` later:** dependency + CSS adoption + theme (0.5 day);
  panels and view show/resize hooks (1 day); persistence with validation and `fixed` mode (0.5
  day); narrow mode (0.5 day); browser checks for drag & drop, popovers and focus in the shadow root,
  plus Playwright (1–1.5 days). About **3.5–4.5 days**, more if multi-file editor tabs become
  dockview panels.

## Integration sketch (for when we adopt)

One deep module, `src/layout/layout.ts` (the `editor/` widget only talks to it; nothing else
imports `dockview`):

```ts
export type PanelId = 'editor' | 'preview' | 'notes' | 'inspector' | 'diagnostics';

export interface LayoutOptions {
  /** 'fixed': our default arrangement, no drag & drop (simple embeds); 'dockable': users rearrange. */
  mode?: 'fixed' | 'dockable';
  /** Which panels exist (host option; e.g. no notes in a read-mostly embed). */
  panels?: PanelId[];
  /** A layout saved earlier from onChange; ignored if it does not fit `panels`. */
  saved?: unknown;
  onChange?(saved: unknown): void;
}

export class Layout {
  constructor(host: HTMLElement, content: Record<PanelId, PanelContent>, options: LayoutOptions);
  show(id: PanelId): void;          // activate (and reveal) a panel, e.g. the Inspector on image select
  isShown(id: PanelId): boolean;
  reset(): void;                    // back to the default arrangement
  destroy(): void;
}

export interface PanelContent {
  readonly element: HTMLElement;    // made once by the widget, never recreated by the layout
  title: string;
  onShown?(): void;                 // re-measure editors after a tab switch / move
  onResize?(): void;
}
```

- Inside: the CSS grid version now; `DockviewComponent` with the `.dockview-theme-te` theme
  later. Neither `SerializedDockview` nor any dockview type crosses the boundary (`saved` is
  opaque JSON with our own version field).
- Default arrangement: `editor` | `notes`+`inspector` (one group, Notes first) | `preview`.
  Narrow (< ~720px host width): one group with tabs, editor first.
- The status bar and global toolbar stay outside the layout in the widget's grid.
- `TypstEditorOptions` gains `layout?: 'fixed' | 'dockable'` (default `fixed`) and
  `onLayoutChange?(saved)` / `savedLayout?`. The element forwards them as properties.

## Prototype on this branch

- `src/layout/dockview-spike.test.ts`: the jsdom test above.
- `demo/dockview.html`, `demo/dockview.ts`: the manual browser check page.
- `dockview` 8.4.1 pinned in `package.json`. If we do not adopt, the branch stays as the record,
  and `main` never gets the dependency.

Sources: npm `dockview`/`dockview-core`/`dockview-enterprise` 8.4.1 (package contents,
`LICENCE.md`, `README.md`, `dist/cjs/**/*.d.ts`, `dist/package/main.esm.mjs`);
<https://dockview.dev/docs/overview/licence>; GitHub dockview/dockview issues and PRs
#425, #426, #774, #1649, #1651, #1653, #1654, #1655, #1656, #1657, #1660; releases v7.0.4
(2026-07-22), v8.0.0 (2026-08-10), v8.4.0 (2026-09-30) and v8.4.1 (2026-10-05).
