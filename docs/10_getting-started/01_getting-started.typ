#import "/template.typ": mermaid

= Getting started <getting-started>

A Typst editor for the browser: a Visual editor (WYSIWYG), a Source editor and a live preview. The Typst compiler runs as WebAssembly in a worker; no server is needed except for collaboration and GitLab integration.

=== Trying it with Docker <getting-started-docker>

To try the demo without installing anything else:

```sh
docker build -t typst-editor-demo .
docker run --rm -p 127.0.0.1:5199:5199 -p 127.0.0.1:1234:1234 typst-editor-demo
```

Then open #link("http://127.0.0.1:5199/")[`http://127.0.0.1:5199/`]. You get the demo (@getting-started-demo) and the collaboration server with a fake GitLab. Nothing is saved: the rooms live in memory, and the Documentation example does not write to `docs/`. Ctrl-C stops both. The first build takes a while, as it compiles the Typst compiler to wasm. With mise: `mise run docker:build` and `mise run docker:run`.

=== The demo <getting-started-demo>

The Docker image (@getting-started-docker) serves the demo on #link("http://127.0.0.1:5199/")[`http://127.0.0.1:5199/`] with a collaboration server and a fake GitLab on `ws://127.0.0.1:1234`. To work on the code, run it from a checkout instead: `mise run demo` (@architecture-development-setup).

The screen:



#figure(
  mermaid(read("../diagrams/workbench-layout.mmd"), width: 75%),
  caption: [The editor: left rail and side panel, editing area, the right side (preview or devtools) and its rail, status bar.],
)

#table(
  columns: 2,
  [Part], [What it holds],
  [Playground bar (top)], [Example; mode Local, Collaborate or GitLab (fake); your name; in Collaborate and GitLab mode a link that opens a second window as another user.],
  [Left rail and side panel], [Files, Find in files (the magnifier), Help; the field over a list opens search everywhere.],
  [Editing area], [The shown file. A Typst file has the tabs Visual and Source (switching keeps the cursor); other files open in their own editor (spreadsheet, diagram, text).],
  [Right side and rail], [The preview; the devtools (@configuration-embedding-devtools).],
  [Status bar], [Errors and warnings; in GitLab mode what is not saved yet.],
)

The examples:

#table(
  columns: 2,
  [Example], [Shows],
  [Simple], [Start here, it opens first: one page with the main features, each with what to try. Typst in five minutes (lists, math, a link, a table); what to type in the Visual editor (`# ` for a heading, `/` for commands, `@` for references) and one of everything it edits (quote, code block, task list, alignment, rule, table of contents, figures, references); custom styles from `styles.typ`; an IronCalc spreadsheet as a table, one value quoted in the text; a Mermaid and a draw.io diagram; a margin comment with a reply.],
  [Advanced], [A report in several files: template, chapters, a helper module with custom styles, an outline, an SVG logo and chart, an IronCalc spreadsheet as a table, a Mermaid diagram, equations, figures with labels and references. GitLab mode always uses it.],
  [Documentation], [This documentation. With `mise run demo` edits are saved to `docs/`.],
)

Main features:

- Visual editing like a word processor, a Source editor and a live preview; a click in the preview jumps to the text.
- All Typst features: what the Visual editor does not model shows as a raw box.
- Images, figures, tables, labels and cross-references.
- Spreadsheets in IronCalc, shown in the document as tables (@features-spreadsheets).
- Diagrams: draw.io and Mermaid (@features-mermaid-diagrams).
- Custom styles from the template.
- Comments as margin notes.
- Slash commands (`/table`) and search everywhere: press Shift twice.
- Help panel: a cheat sheet for the shown file.
- Collaboration and saving to GitLab; PDF download.

The page's state is its URL:

#table(
  columns: 2,
  [Query], [Effect],
  [`?example=simple|advanced|docs`], [The project. `docs` is this documentation: edits are saved to `docs/` when running `mise run demo` (@architecture-development-writing-docs); in a static build nothing is saved.],
  [`?room=<name>`], [Collaborate mode: joins a room on the local server.],
  [`?room=gitlab:demo/report@main`], [GitLab mode: a branch of the fake repository.],
  [`&user=<name>`], [The name others see; signs comments and commits.],
  [`#/chapters/intro.typ:12`], [The file shown and the cursor's line (1-based): a reload or a shared link opens the file with the cursor at the start of that line. It follows while you work.],
)

Next: what users get (@features-wysiwyg-editing), every setting and option (@configuration-options), the collaboration server (@configuration-collaboration-server), embedding and events (@configuration-embedding), how it is built and adding features (@architecture-overview, @architecture-extensions-overview).
