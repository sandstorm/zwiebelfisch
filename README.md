# Typst editor

A Typst editor for the browser: a Visual editor (WYSIWYG), a Source editor and a live preview. The Typst
compiler runs as WebAssembly in a worker. Embed it as `<typst-editor>` or with `createTypstEditor`.
Every feature is an extension. Real-time collaboration (optional) needs the server in `server/`.

## Features

This project is both an *authoring environment* and an *embeddable WYSIWYG editor* for Typst files.

### Basic features

- **Visual editor:** edits Typst projects like a word processor, including styling, headlines, lists, …
- Typographic **rendering preview**, displaying the full source document.
- For nerds, a **Source editor** where you can write the Typst file directly is also included :-)
- **Standard word processor styling and shortcuts** supported (via [Tiptap](https://tiptap.dev/) and [ProseMirror](https://prosemirror.net/))
- Support for **code blocks with syntax highlighting**, via ```` ``` ```` for multiline code and `` ` `` for inline code
- Support for **images**
- Support for **tables**
- **Headings and table of contents**
- **Labels and cross-references** to headings, figures and tables
- **Page layout:** page breaks and rules
- **Full Typst support:** if an element is not supported natively, e.g. maths like $E=m*c^2$, we always fall back to the raw Typst source.
- **Files:** a file panel for every file of the project
- **PDF** download

### User experience

- **Slash commands:** type `/` in the Visual editor for everything the Insert and text style menus offer
- **Search everywhere:** files, headings, labels, commands, text; press Shift twice
- **Bidirectional navigation:** click any part of the preview to jump to the corresponding source, and select any part of the interactive editor to highlight this in the preview.
- **Help:** a cheat sheet for the file you edit
- **Invisible characters**, as a word processor's formatting marks

### Advanced features

- Support for **custom styles**, so you can easily create inline styles and **block styles** for things like custom call-outs.
- Support for **draw.io diagrams**, which can be directly edited inline and embedded.
- Support for **spreadsheets** (based on [IronCalc](https://www.ironcalc.com/)), which can be edited inline, including calculations, and then embedded (fully or partially) into the Typst file
  - spreadsheet styling is transferred to Typst
- Support for **Mermaid diagrams** if you prefer text-based diagrams.
- Support for **multi-file** projects.
- **Comments** as margin notes in the Typst source
- Support for **collaborative real-time editing**.
- **GitLab** integration: edit any Typst project from GitLab, and write back changes.

## Try it with Docker

```sh
docker build -t typst-editor-demo .
docker run --rm -p 127.0.0.1:5199:5199 -p 127.0.0.1:1234:1234 typst-editor-demo
```

Open http://127.0.0.1:5199/: the built demo plus a collaboration server with a fake GitLab. Nothing is saved.
Ctrl-C stops it. (`mise run docker:build` and `mise run docker:run` do the same.)

Released images: `docker run --rm -p 127.0.0.1:5199:5199 -p 127.0.0.1:1234:1234 ghcr.io/<owner>/<repo>:<version>` (`:main` follows the main branch).

## Quick start

To work on the code: requires [mise](https://mise.jdx.dev); it pins every tool.

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
(`mise run demo:build`: the same on the production build, so it loads as in production).

- `?example=simple|advanced|docs`: the project to open (`docs` edits this documentation live).
- `?room=gitlab:demo/report@main` opens a fake GitLab branch; `?room=<name>` collaborates in a plain room.

## Documentation

One Typst project in [`docs/`](docs/), starting at [`docs/main.typ`](docs/main.typ):

- **Getting started** (`docs/10_getting-started/`): trying the demo.
- **Features** (`docs/20_features/`): what users get, one chapter per area.
- **Configuration** (`docs/30_configuration/`): configuration options, embedding, the collaboration server, GitLab integration, for technical users.
- **Architecture** (`docs/40_architecture/`): how the code is built, writing an extension, conventions, development.

Online: `https://<owner>.github.io/<repo>/` (the latest release, with the demo under `demo/`).

Read it as a PDF (`mise run docs:pdf`), as HTML (`mise run docs:html`), or edit it live in the demo's
Documentation example (`mise run demo` or `mise run demo:build`, then `?example=docs`).
