# Typst editor

A Typst editor for the browser: a Visual editor (WYSIWYG), a Source editor and a live preview. The Typst
compiler runs as WebAssembly in a worker. Embed it as `<typst-editor>` or with `createTypstEditor`.
Every feature is an extension. Real-time collaboration (optional) needs the server in `server/`.

## Quick start

Requires [mise](https://mise.jdx.dev); it pins every tool.

```sh
mise install            # the pinned tools
mise run install        # JS dependencies and Playwright browsers
mise run demo           # builds engine and fonts, then the demo on http://127.0.0.1:5199/ and a local server
```

| Command | What it does |
|---|---|
| `mise run demo:build` | the demo as in production (built bundle, `vite preview`) on the same ports, with the local server |
| `mise run build:lib` | the library → `dist/lib` |
| `mise run typecheck`, `mise run quality`, `mise run test:unit` | the checks before a commit |
| `mise run docs:pdf` | the documentation as a book → `dist/docs/typst-editor.pdf` |
| `mise run docs:html` | the documentation as HTML pages → `dist/docs/html/` |
| `mise tasks ls` | every task |

## Demo

`mise run demo` serves http://127.0.0.1:5199/ plus a local collaboration server with a fake GitLab
(`mise run dev`: the page alone, Local mode only). `mise run demo:build` builds the demo first and serves the build
(`vite preview`) the same way, so it loads as in production: a few bundled files instead of many modules.

- `?example=hello|simple|advanced|docs`: the project to open (`docs` edits this documentation live).
- `?room=<name>` collaborates in a room; `?room=gitlab:demo/report@main` opens a fake GitLab branch.
- `&devtools`: the devtools side panel (the library's optional `devtools` extension): document, contributions, events.

## Documentation

One Typst project in [`docs/`](docs/), starting at [`docs/main.typ`](docs/main.typ):

- **Guide** (`docs/10_guide/`): getting started, features, configuration, collaboration, embedding.
- **Extensions** (`docs/20_extensions/`): writing an extension.
- **Architecture** (`docs/30_architecture/`): how the code is built, conventions, development.

Read it as a PDF (`mise run docs:pdf`), as HTML (`mise run docs:html`), or edit it live in the demo's
Documentation example (`mise run demo` or `mise run demo:build`, then `?example=docs`).
