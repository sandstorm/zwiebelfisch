# Preview UX

Status: open
Depends on: nothing
Touches: src/preview/**, src/editor/styles.css

## Goal
- Highlight the clicked element's region in the preview (not just jump in source).
- Cursor → preview reveal is throttled and only scrolls when the target is off-screen.
- Zoom (fit width / 100% / +/-), page numbers.
- Large documents: only render SVG for pages near the viewport (IntersectionObserver), keep
  placeholders sized from page width/height.

## Acceptance
Playwright specs for zoom and for a 30-page doc staying responsive while typing.
