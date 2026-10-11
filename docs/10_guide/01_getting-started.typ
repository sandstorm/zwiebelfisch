= Getting started <guide-getting-started>

A Typst editor for the browser: a Visual editor (WYSIWYG), a Source editor and a live preview. The Typst compiler runs as WebAssembly in a worker; no server is needed except for collaboration and GitLab integration.

== Custom Compilation <guide-getting-started-setup>

(TODO: Custom compilation should be advanced Dev Topic. TODO: BUILD DOCKER IMAGE???)

Requires #link("https://mise.jdx.dev")[mise]. It pins every tool: Node, pnpm, the Typst CLI, Rust (with the `wasm32` target), wasm-bindgen and binaryen.

```sh
mise install            # the pinned tools
mise run install        # JS dependencies and Playwright browsers
mise run demo           # builds the engine and fonts, then 
```

== The demo <guide-getting-started-demo>

`mise run demo` starts the demo on `http://127.0.0.1:5199/` and a collaboration server with a fake GitLab on `ws://127.0.0.1:1234`. Ctrl-C stops both.

The screen (layout figure: @guide-features-editors):

#table(
  columns: 2,
  [Part], [What it holds],
  [Playground bar (top)], [Example; mode Local, Collaborate or GitLab (fake); your name; the devtools switch; in Collaborate and GitLab mode a link that opens a second window as another user.],
  [Left rail and side panel], [Files, Help; the magnifier opens search everywhere.],
  [Editing area], [The shown file. A Typst file has the tabs Visual and Source; other files open in their own editor (spreadsheet, diagram, text).],
  [Right side and rail], [The preview; the devtools when switched on.],
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

- Visual editing like a word processor; what it does not model shows as a raw box (@guide-features-visual).
- Source editing with highlighting; both editors edit the same text (@guide-features-editors).
- Live preview; a click in it jumps to the text (@guide-features-editors).
- Images, figures and tables (@guide-features-images, @guide-features-tables).
- Spreadsheets in IronCalc, shown in the document as tables (@guide-features-spreadsheets).
- Diagrams: draw.io (@guide-features-diagrams) and Mermaid (@guide-features-mermaid).
- Custom styles from the template (@guide-features-styles).
- Labels and cross-references (@guide-features-labels).
- Comments as margin notes (@guide-features-comments).
- Slash commands (`/table`) and search everywhere: press Shift twice (@guide-features-search).
- Help panel: a cheat sheet for the shown file (@guide-features-help).
- Collaboration and saving to GitLab (@guide-features-collaboration); PDF download (@guide-features-pdf).

The page's state is its URL:

#table(
  columns: 2,
  [Query], [Effect],
  [`?example=simple|advanced|docs`], [The project. `docs` is this documentation: edits are saved to `docs/` when running `mise run demo` (@architecture-development-writing-docs); in a static build nothing is saved.],
  [`?room=<name>`], [Collaborate mode: joins a room on the local server.],
  [`?room=gitlab:demo/report@main`], [GitLab mode: a branch of the fake repository.],
  [`&user=<name>`], [The name others see; signs comments and commits.],
  [`&devtools`], [The devtools side panel on the right: document, contributions, events (@guide-embedding-devtools).],
  [`#/chapters/intro.typ:12`], [The file shown and the cursor's line (1-based): a reload or a shared link opens the file with the cursor at the start of that line. It follows while you work.],
)

== A first editor <guide-getting-started-first-editor>

`mise run build:lib` builds the library into `dist/lib` (@guide-embedding-library). It is not on npm yet: copy `dist/lib`, or depend on the repository folder, whose `package.json` exports it as `typst-editor`.

Without a bundler:

```html
<script type="module" src="/vendor/typst-editor/typst-editor.js"></script>

<typst-editor style="height: 600px">
  = Hello

  Some *Typst*.
</typst-editor>
```

From JavaScript:

```ts
import { createTypstEditor } from 'typst-editor';

const editor = createTypstEditor(document.getElementById('editor')!, {
  source: '= Hello\n',
  onFilesChange: (change) => save(change),
});
```

A complete page: `examples/plain-html/index.html`. After `mise run build:lib`, serve the repository root and open `/examples/plain-html/`.

Next: what users get (@guide-features), every setting and option (@guide-configuration), editing with others (@guide-collaboration), embedding and events (@guide-embedding), adding features (@extensions-overview).
