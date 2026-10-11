# Typst editor

A Typst editor for the browser: a Visual view (WYSIWYG), a Source view and a live preview. The Typst
compiler runs as WebAssembly in a worker. Embed it as `<typst-editor>` or with `createTypstEditor`.
Every feature is an extension. Real-time collaboration (optional) needs the server in `server/`.

## Quick start

Requires [mise](https://mise.jdx.dev); it pins every tool.

```sh
mise install            # the pinned tools
mise run install        # JS dependencies and Playwright browsers
mise run build:fonts    # Typst's default fonts, once
mise run demo           # the demo on http://127.0.0.1:5199/ and a local collaboration server
```

| Command | What it does |
|---|---|
| `mise run build:lib` | the library → `dist/lib` |
| `mise run typecheck`, `mise run quality`, `mise run test:unit` | the checks before a commit |
| `mise run docs:pdf` | the documentation as a book → `dist/docs/typst-editor.pdf` |
| `mise run docs:html` | the documentation as HTML pages → `dist/docs/html/` |
| `mise tasks ls` | every task |

## Documentation

One Typst project in [`docs/`](docs/), starting at [`docs/main.typ`](docs/main.typ):

- **Guide** (`docs/guide/`): getting started, embedding, features, collaboration.
- **Extensions** (`docs/extensions/`): writing an extension.
- **Architecture** (`docs/architecture/`): how the code is built, conventions, development.

Read it as a PDF (`mise run docs:pdf`), as HTML (`mise run docs:html`), or edit it live in the demo's
Documentation example (`mise run demo`, then `?example=docs`).
