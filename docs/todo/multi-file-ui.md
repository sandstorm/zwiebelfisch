# Multi-file UI (optional mode)

Status: open
Depends on: multi-file-assets-packages (engine + widget API for file maps)
Touches: src/editor/** (file switcher), src/document/** (one TypstDocument per file), src/preview/** (jump into other files)

## Goal
Multi-file projects are **optional**: with a single file the widget looks exactly as today.
When the widget gets more than one file (or `files: 'show'`), a compact file switcher appears
above the editing view:
- list of `.typ` files (main file marked) + assets (images, data) — click to open; assets are
  shown read-only (image preview) and can be referenced via "insert image";
- add / rename / delete file, upload an asset (drag & drop) — each behind an API hook so the
  host app (or the GitLab server later) decides what is allowed and persists it;
- every `.typ` file has its own `TypstDocument`; Visual and Source view show the active file;
  the preview always compiles the main file with all files.
- Preview click into a different file (`jump.path !== active`) switches the active file, then
  reveals the range. Diagnostics status lists errors per file; clicking opens that file.

## API sketch
```ts
createTypstEditor(el, {
  files: { '/main.typ': '…', '/chapter1.typ': '…', '/logo.png': bytes },
  main: '/main.typ',
  fileList: 'auto' | 'show' | 'hide',          // auto: show when >1 file
  onFilesChange?(change: { path, kind: 'create'|'update'|'delete'|'rename', … }): void,
})
```

## Acceptance
- Single-file usage unchanged (existing e2e specs pass untouched).
- Playwright: two-file project; clicking text from `chapter1.typ` in the preview opens that file
  in the editor and highlights it; editing it updates the preview.
- vitest: file map model (add/rename/delete, main file protection).

## Out of scope
Folder trees beyond one level; server persistence (server-gitlab task).
