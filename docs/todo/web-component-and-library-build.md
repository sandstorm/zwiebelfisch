# `<typst-editor>` web component and library build

Status: done (branch task/web-component-and-library-build)
Depends on: nothing
Touches: src/index.ts, src/editor/** (element wrapper only), vite.config.ts (or a separate lib config), package.json, mise-tasks/build/**, docs/embedding.md

## Goal
The widget is embeddable anywhere: an npm-style ES module build (`dist/lib`) exporting
`createTypstEditor` and registering a `<typst-editor>` custom element with attributes/properties
(`value`, events `change`), worker + wasm emitted as assets that resolve relative to the module.

## Context
- Vite library mode with the worker (`new Worker(new URL(...), {type: 'module'})`) and the
  `?url` wasm import must keep working from a consumer's bundler and from a plain `<script type=module>`.
- Styles are injected into `document.head`; for a custom element consider shadow DOM — but
  CodeMirror and ProseMirror need their styles inside the shadow root (CodeMirror supports `root`).
  Decide and document.

## Acceptance
- `mise run build:lib` produces `dist/lib` with ESM + d.ts.
- A plain HTML example (`examples/plain-html/index.html`) using `<typst-editor>` works (e2e spec).
- docs/embedding.md explains both APIs.

## Out of scope
Publishing to npm; React/Vue wrappers.
