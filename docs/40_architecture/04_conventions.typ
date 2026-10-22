#import "../template.typ": unreviewed

= Conventions <architecture-conventions>

Rules for anyone changing the code, people and coding agents alike. *THIS CHAPTER IS FOR CODING AGENTS ONLY*. `mise run quality` checks what it can (@architecture-development-checks); the rest is on you.

== Before you write <architecture-conventions-design>

- *Lower total complexity, measured in obviousness, not lines.* Every type, helper or contribution point of ours is a concept someone must learn: prefer the frameworks' concepts and plain code.
- *Propose new concepts first.* A new abstraction, contribution point or value type goes to the maintainer with what it replaces and what it brings. Renames, moves and plain functions are not new concepts.
- *Ask before moving or folding files* across modules; report the candidates and let the maintainer decide each one.
- *Deep modules:* much hidden behind a small interface (_A Philosophy of Software Design_). Don't split a deep class into shallow ones; no pass-through layers.
- *Information hiding:* expose what callers need; no member exists only for tests or one caller.
- *Remove what does not work* rather than polish it. No backwards compatibility, shims or migration notes: the project is young.

== Where code goes <architecture-conventions-layers>

- *Highest layer that can hold it,* next to its consumers: extension, then host, then core. A host function only one extension uses moves into that extension.
- *Imports go down only* (`eslint.config.js`, `layers`): `editor/`, `editor-element/` → `extensions/<name>/` → its `model/` → `core/`; `hosts/` → `core/`. No cycles.
- *`core/` and `model/` have no DOM,* no editor library, no Yjs. The line between model and view is the DOM.
- *Hosts keep only mechanism.* For each host member ask: mechanism, or one feature's policy? Policy is an extension.
- *Extensions never depend on each other:* no imports, no shared services, no calling each other's commands, no relying on each other's schema names. A host offers a generic point; the consumer reads every contribution. Another extension's schema names are read only as data, guarded (`schema.nodes.x`, `editor.can()`).

== Modules and files <architecture-conventions-modules>

- *A module* is `core/<name>/`, `hosts/<name>/`, `extensions/<name>/`, `editor/`, `editor-element/` or `testing/`. From outside, import only its *entry* `<name>.ts`.
- *A host's entry is its contract:* interfaces first, re-exports of its implementation (`<name>-impl.ts`) and helpers (`<name>-helpers.ts`) at the bottom. `<name>-impl.ts` starts with `See <Contract> in <name>.ts`.
- *Sub-modules* are listed in `subModules` (`eslint.config.js`), entry `<sub>/<sub>.ts`. Other subfolders (`model/`, `visual-editor/`, `worker/`) have no entry.
- *About 3 source files* at a module's top level; more get subfolders named after a concept. Never `utils/`, `helpers/`, `shared/`, `impl/`, `services/`.
- *No re-exports,* except `src/index.ts` and a host contract's.
- *Files read general to specific:* the main export first, then other exports, then private helpers in order of use.
- *Module scope holds constants and pure functions only.* State lives in an instance with the widget's lifetime (a host's constructor, an extension's `activate`). Exceptions: a `WeakMap` memo on immutable values; a named singleton for what exists once per page (the wasm instance).
- *`*.worker.ts`* runs only in a Web Worker.

== Extension API <architecture-conventions-api>

- *VS Code's names and shapes* where the concept matches: `activate`, `subscriptions`, `register…Provider`, `provide…` / `resolve…`, `onDid<Verb>`, `executeCommand`, `getConfiguration`, `show…Message`. Object-oriented, as VS Code's API.
- *Name the framework* when a member takes its object (`registerTiptapExtension`, `registerCodeMirrorExtension`); never rename framework types. Take ProseMirror objects from the editor, never from a copy.
- *Register once, at activation;* return a `Disposable`. One disposal verb: `dispose()` (library hooks keep theirs: `destroy`).
- *Competing contributions* need an explicit tie-breaker (@architecture-extensions-rules).
- *Command handlers run synchronously* (focus, selection and user activation stay intact), even though `executeCommand` returns a promise.
- *Talk to the user through `window`* (`show…Message`, `showInputBox`, `showQuickPick`, `showContextMenu`), never hand-made popovers. Editing stays inline, as in Notion: no inspector panels.
- *State:* `globalState` / `workspaceState`, never `localStorage` directly.
- *CSS:* each host and extension brings `<name>.css` (an extension via `registerStyleSheet`); classes `zwf-<extension>__…--…`; colors only from `--zwf-*` tokens; never style another host's classes.

== Names and types <architecture-conventions-naming>

- *Product name Zwiebelfisch:* `zwf-` CSS and test ids, `ZWF_` env vars, `zwf:` storage keys. "Typst" only where it means the language (`TypstDocument`, `typst.*` ids).
- *Names say what it does:* compute without applying is `calculate…` (`calculateImportChange`).
- *Commands out, events back:* `FileChange`, `TextChange` go out; `onDid…` events come back; indexes (`LabelIndex`) are read models. Nobody calls `refresh()`.
- *Value types, not bare strings and numbers:* branded types with a same-named companion (`ProjectPath.parse`, `SourceOffset.of`), parsed at the edges (public API, Yjs, storage, engine). Framework numbers stay as they are; conversions live in one place (`sourceToPos` / `posToSource`).
- *Unions discriminate on `kind`;* wire messages (room, worker) on `type`.
- *No "main file vs. the rest" special cases* in the API.

== Comments <architecture-conventions-comments>

- *One "why" comment per concept:* the doc comment of a module entry's main element. First line: what it is. Then who uses it (a list if several) and what it guarantees, concretely. Under ~10 lines. No rationale, no neighbours, no "see also", no history. Model: `src/hosts/commands/commands.ts`.
- *Every other file points to it:* first line `See <Name> in <path>`; a test file starts `Tests for X`. Checked by `quality:top-comments`.
- *API doc comments* say what a parameter or result means; never restate the code.
- *Match the surrounding code:* comment density, naming, idiom.

== Tests and commits <architecture-conventions-process>

- *Test through the exported interface.* Model tests run without jsdom. A host's tests use its own minimum plus specs defined in the test; whole-widget tests live in `editor/` or use `testing/`.
- *Agents in the sandbox* cannot launch browsers or bind ports: write the Playwright spec, the maintainer runs it.
- *One commit per step,* all checks green (@architecture-development-checks); docs change in the same commit as the code.
- *Docs are Typst* in `docs/`; working notes may live in `docs/YYYY_MM_DD_slug.md` until distilled into a chapter, then they are deleted. Open work goes to @architecture-development-open-work.
