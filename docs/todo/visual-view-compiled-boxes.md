# Visual view: compiled raw boxes and rendered images

Status: done (branch task/visual-view-compiled-boxes)
Depends on: visual-view-links-images-tables, multi-file-ui
Touches: src/visual-view/raw-box.ts, src/visual-view/visual-view.ts (an option), src/preview (snippet compile), src/editor/typst-editor.ts (wiring)

## Goal
- **Raw boxes rendered as compiled snippets** where possible (e.g. display math): show the
  compiled SVG when the box is not focused, and the code when it is.
- **Images rendered** in `image` blocks: show the picture from the project files (`files`
  option, `FileContent` bytes) above or instead of its code while the box is not focused.
- **Inserting an image from the widget** (upload / pick from project files), adding the file to
  the project and an `#image("path")` block.

## Context
Split off from [visual-view-links-images-tables](visual-view-links-images-tables.md), which added
the `image` node (source kept like a raw box, headed by its path; `imagePath(src)` in
`projection.ts`) and an "Insert image" button that asks for a path.
- The Visual view only knows the `TypstDocument`. Rendering needs access to the project files
  (e.g. a `resolveFile(path)` option of `VisualView`, set by `createTypstEditor`) and, for
  snippets, a compile channel (the preview worker, with the main file's `#set` rules as context).
- Raw boxes are `raw-box.ts` NodeViews hosting CodeMirror; a rendered view would toggle on focus.

## Acceptance
Unit tests (jsdom) for the node views switching between render and code; Playwright specs for
math and an image from `files` showing rendered and switching to code on click.

## Out of scope
Image resizing/cropping in the Visual view.

## Outcome
- Snippets are cut from the main document's compiled pages (no extra compile):
  `Preview.snippet(path, from, to, text)` → `boxesForRanges` → page SVG with a cropped
  `viewBox` (`src/preview/snippet.ts`). `boxesForRanges` now also returns shapes and images, so
  fraction lines, rectangles and figure images are inside the crop (and get change bars).
- `RenderedBox` (`src/visual-view/rendered-box.ts`) toggles picture/code on focus; the widget
  provides `BoxRenderer` + `ImageAssets` through `ProjectRenderings` (`src/editor`).
- "Insert image" lists the project's images and uploads new ones (through `allowFileChange`).
- Tests: jsdom unit tests (`rendered-box.test.ts`, toolbar, `project-renderings.test.ts`,
  `snippet.test.ts`, engine shapes test); Playwright `tests/e2e/visual-compiled-boxes.spec.ts`.
