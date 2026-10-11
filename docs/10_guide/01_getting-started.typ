= Getting started <guide-getting-started>

A Typst editor for the browser: a Visual view (WYSIWYG), a Source view and a live preview. The Typst compiler runs as WebAssembly in a worker; no server is needed except for collaboration.

== Setup <guide-getting-started-setup>

Requires #link("https://mise.jdx.dev")[mise]. It pins every tool: Node, pnpm, the Typst CLI, Rust (with the `wasm32` target), wasm-bindgen and binaryen.

```sh
mise install            # the pinned tools
mise run install        # JS dependencies and Playwright browsers
mise run demo           # builds the engine and fonts, then starts the demo and a local server
```

- The first engine build compiles the Typst compiler to wasm, and Typst's default fonts are copied next to it, with their index. Later runs skip both until `crates/typst-engine` changes.
- Other tasks (tests, checks, builds): @architecture-development.

== The demo <guide-getting-started-demo>

`mise run demo` starts the demo on `http://127.0.0.1:5199/` and a collaboration server with a fake GitLab on `ws://127.0.0.1:1234`. Ctrl-C stops both. `mise run dev` starts the demo alone (Local mode only).

`mise run demo:build` builds the demo first (the production bundle, as the end-to-end tests use it) and serves the build with `vite preview`, on the same addresses and with the same server. It loads as a deployed widget does: a few bundled files instead of the dev server's many modules. A change to the code needs another `mise run demo:build`.

The page's state is its URL:

#table(
  columns: 2,
  [Query], [Effect],
  [`?example=hello|simple|advanced|docs`], [The project. `docs` is this documentation: edits are saved to `docs/` when running `mise run demo`, `demo:build` or `dev` (@architecture-development-writing-docs); in a static build nothing is saved.],
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
