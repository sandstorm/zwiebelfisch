# Fix: UI breaks when uploading an image
Status: done (branch task/fix-image-upload-ui)
Depends on: visual-view-compiled-boxes, multi-file-ui
Touches: src/visual-view/{image-insertion,image-choices,toolbar,field-popover}.ts, src/editor/{project-renderings,file-switcher,typst-editor}.ts, src/editor/styles.css, tests/e2e/image-upload.spec.ts

## Goal
A user reported "UI breaks when uploading an image". Uploading an image (the Visual view's
Insert image → Upload image…, or a file dropped on the editor) must add it to the project, insert
`#image(..)` where expected and leave everything else as it was: the document, the active file,
the panes and the focus.

## Context
Path: `ImageChoices` (popover) → `ImageAssets.upload` (`ProjectRenderings`) → `request` →
`Project.apply(create)` → `Widget.changed` (file bar appears in `auto` mode, preview recompiles)
→ `choose` → Tiptap insert → `VisualView` writes the source → preview → `RawBox`/`RenderedBox`
shows the image. Drops: ProseMirror / CodeMirror handlers, then `FileSwitcher`'s `acceptDrops`.

## Acceptance
- vitest (jsdom) reproductions for every fixed cause; `mise run quality` passes.
- Playwright `tests/e2e/image-upload.spec.ts`: upload via `setInputFiles`, drop into the text,
  drop on the preview; panes keep place and size, image inserted, main.typ stays active.

## Out of scope
Comments (another branch), the projection, snippet size (see Outcome).

## Outcome
Found, by reading the code paths and reproducing in jsdom:

1. **Insert image replaced `#set page(..)`** (confirmed, jsdom). Until the user clicks into the
   text, the Visual view's selection is a node selection on the first raw block, typically the
   `#set page` / `#set text` rules. `insertContent` replaced it: the page setup vanished and the
   preview re-laid out on default A4 with the default font — the most likely "UI breaks". With
   the cursor in a heading the image split the heading in two; a selected range was replaced.
   Fix: `insertImages` (`image-insertion.ts`) puts image blocks after the selected block or
   after the paragraph / heading holding the cursor; only an empty paragraph is taken over.
2. **Dropping an image on the editor replaced the whole page with the image** (confirmed from
   the ProseMirror source: it cancels `dragover` but leaves file drops without text to the
   browser, which opens the file). The file bar only took drops while shown, never over the
   preview. Fix: image files dropped on / pasted into the Visual view are uploaded and inserted
   at the drop point (`imageFileDrops`); the file bar now listens on the whole widget and
   swallows file drops while hidden; its drop hint ends even when a view inside takes the drop.
3. **Silent failures**: a refused upload (host veto, HEIC/BMP, a second file of the same name)
   did nothing at all. `ImageAssets.upload` now resolves to `{ path } | { error }` and the
   popover shows the error; an identical file is reused, a different one gets `name-2.png`
   (every pasted screenshot is `image.png`); the picker only offers formats Typst shows.
4. **Big photos** filled the editing view (only width was limited): capped at 24em height.
5. **Popover past the pane's right edge**: Insert image is the last toolbar group, so its popover
   (up to 360px) made a narrow editing pane scroll sideways; popovers now shift left to fit.

Checked and fine: the file bar appearing on the first upload (by design in `auto` mode; it is
inside the editing column, the grid does not move), the active file (the toolbar path never
opens the asset view), object URLs, the worker file transfer (no buffer is transferred away).

Uncertain without a browser run — `tests/e2e/image-upload.spec.ts` needs `mise run test:e2e`:
- the real drop flow (`posAtCoords` on a real drop, Firefox/WebKit `DataTransfer` via
  `dispatchEvent`), focus after insertion in the shadow DOM (`toBeFocused`), and the exact
  pixel checks (picture height, no sideways overflow);
- the existing `visual-compiled-boxes`, `visual-links-tables` and `multi-file-ui` specs should
  still pass (image placement only changed where they never click: they click into the text first).

Remaining (not changed here):
- File-bar uploads still open the uploaded file in the asset view (switching away from the
  text). That was the multi-file-ui design; a drop into the text no longer does.
- Snippets (`cropSvg`) keep the whole page SVG, so every rendered raw box on a page with a big
  photo carries the photo as base64 and is re-encoded on every compile — likely typing lag after
  uploading large photos. Worth cutting images outside the crop from snippets.
- Dropping files on the Source view still lets CodeMirror insert the text of text files (e.g. an
  SVG's markup) besides the file bar's upload.
