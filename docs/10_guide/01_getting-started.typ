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


The page's state is its URL:

#table(
  columns: 2,
  [Query], [Effect],
  [`?example=hello|simple|advanced|docs`], [The project. `docs` is this documentation: edits are saved to `docs/` when running `mise run demo` (@architecture-development-writing-docs); in a static build nothing is saved.],
  [`?room=<name>`], [Collaborate mode: joins a room on the local server.],
  [`?room=gitlab:demo/report@main`], [GitLab mode: a branch of the fake repository.],
  [`&user=<name>`], [The name others see; signs comments and commits.],
  [`&devtools`], [The devtools side panel on the right: document, contributions, events (@guide-embedding-devtools).],
  [`#/chapters/intro.typ`], [The file shown.],
)

The playground bar at the top switches example and mode, turns the devtools on and off, and opens a second window as another user.

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
