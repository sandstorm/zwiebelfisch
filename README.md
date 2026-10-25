# Zwiebelfisch

Zwiebelfisch is a Typst editor for the browser: a Visual editor (WYSIWYG), a Source editor and a live preview. The Typst
compiler runs as WebAssembly in a worker. Embed it as `<zwiebelfisch-editor>` or with `createEditor`.
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

## Run it with Docker

The image is Zwiebelfisch against your GitLab: the start page, the editor and the collaboration server on one port.
Register an OAuth application on the GitLab instance (scopes `openid profile email read_api write_repository`,
callback `http://localhost:1234/api/public/auth/callback`), then:

```sh
docker run --rm -p 127.0.0.1:1234:1234 -v zwiebelfisch-data:/data \
  -e ZWF_ALLOWED_ORIGINS=http://localhost:1234 -e ZWF_GITLAB_URL=https://gitlab.example.org \
  -e ZWF_AUTH_CLIENT_ID=… -e ZWF_AUTH_CLIENT_SECRET=… \
  ghcr.io/sandstorm/zwiebelfisch:main
```

Open http://localhost:1234/. `mise run docker:build` builds the image from a checkout, `mise run docker:run` runs it
with the variables from your environment. Deploying it: `docs/30_configuration/05_deployment.typ`.

## Quick start

To work on the code: requires [mise](https://mise.jdx.dev); it pins every tool.

```sh
mise install            # the pinned tools
mise run install        # JS dependencies and Playwright browsers
mise run demo           # builds engine and fonts, then the demo on http://127.0.0.1:5199/ and a local server
```

| Command | What it does |
|---|---|
| `mise run build:demo`, then `mise run demo preview` | the demo as in production (built bundle, `vite preview`) on the same ports, with the local server |
| `mise run build:lib` | the library → `dist/lib` |
| `mise run typecheck`, `mise run quality`, `mise run test:unit` | the checks before a commit |
| `mise run docs:pdf` | the documentation as a book → `dist/docs/zwiebelfisch.pdf` |
| `mise run docs:html` | the documentation as HTML pages → `dist/docs/html/` |
| `mise tasks ls` | every task |

## Demo

`mise run demo` serves http://127.0.0.1:5199/ plus a local collaboration server with a fake GitLab
(`mise run demo preview`: the same on the last production build, `mise run build:demo`, so it loads as in production).

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
Documentation example (`mise run demo`, then `?example=docs`).
