#import "/template.typ": mermaid

= Getting started <getting-started>

A Typst editor for the browser: a Visual editor, a Source editor and a live preview. The Typst compiler runs as WebAssembly in the browser, so *no server is needed* except for collaboration and GitLab.

=== Trying it with Docker <getting-started-docker>

```sh
docker build -t typst-editor-demo .
docker run --rm -p 127.0.0.1:5199:5199 -p 127.0.0.1:1234:1234 typst-editor-demo
```

Then open #link("http://127.0.0.1:5199/")[`http://127.0.0.1:5199/`]. You get the demo and the collaboration server with a fake GitLab.

- *Nothing is saved*: rooms live in memory. Ctrl-C stops both.
- The first build takes a while, as it compiles the Typst compiler to wasm.
- With mise: `mise run docker:build` and `mise run docker:run`.

To work on the code, run `mise run demo` from a checkout instead (@architecture-development-setup).

=== The demo <getting-started-demo>

#figure(
  mermaid(read("../diagrams/workbench-layout.mmd"), width: 75%),
  caption: [The editor: left rail and side panel, editing area, the right side (preview or devtools) and its rail, status bar.],
)

- *Playground bar* (top): the example; the mode Local, Collaborate or GitLab (fake); your name. In Collaborate and GitLab mode, a link opens a second window as another user.
- *Left rail*: Files, Find in files (the magnifier), search everywhere (a field over a list), Help.
- *Editing area*: a Typst file has the tabs Visual and Source (switching keeps the cursor); spreadsheets, diagrams and text files open in their own editor.
- *Right side*: the preview, or the devtools (@configuration-embedding-devtools).
- *Status bar*: errors and warnings; in GitLab mode what is not saved yet.

*Examples:* start with *Simple*, which opens first: one page with the main features, each with what to try. *Advanced* is a report in several files (template, chapters, custom styles, a spreadsheet, diagrams, figures and references); GitLab mode always uses it. *Documentation* is this book; with `mise run demo` your edits are saved to `docs/`.

*The URL holds the state*, so a reload or a shared link opens the same place:

#table(
  columns: 2,
  [Query], [Effect],
  [`?example=simple|advanced|docs`], [The example. `docs` saves to `docs/` only with `mise run demo` (@architecture-development-writing-docs).],
  [`?room=<name>`], [Collaborate mode: joins a room on the local server.],
  [`?room=gitlab:demo/report@main`], [GitLab mode: a branch of the fake repository.],
  [`&user=<name>`], [The name others see; signs comments and commits.],
  [`#/chapters/intro.typ:12`], [The file shown and the cursor's line.],
)

Next: the features (@features-wysiwyg-editing), the options (@configuration-options), embedding (@configuration-embedding), the collaboration server (@configuration-collaboration-server), and how it is built (@architecture-overview, @architecture-extensions).
