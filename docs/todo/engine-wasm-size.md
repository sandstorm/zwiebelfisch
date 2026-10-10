# Shrink the engine wasm (41 MB → a few MB)

Status: open
Depends on: nothing
Touches: crates/typst-engine/**, src/engine/**, src/preview/engine.worker.ts, mise-tasks/build/engine, mise.toml, vite.config.ts

## Goal
The page downloads a 41 MB `typst_engine_bg.wasm` before anything renders. Most of that is fonts
embedded through `typst-assets`' `fonts` feature. Make the first render download as little as
possible.

## Context
- `crates/typst-engine/src/world.rs`: `MemoryWorld::new()` loads `typst_assets::fonts()`.
- Fonts should become separate static assets (`.otf`/`.ttf`, ideally woff2-free since Typst needs
  raw OpenType), passed into the engine from JS (e.g. `engine.addFont(bytes)`), loaded by the
  worker. Default set: the fonts `typst-assets` ships (Libertinus Serif, New Computer Modern
  (+Math), DejaVu Sans Mono). Consider lazy loading: Typst's `FontBook` needs the font *info*
  up front but font *data* only on use — a small JSON index of `FontInfo` plus lazy fetching is
  the ideal (typst.ts does this as "lazy fonts"); a simpler first step is loading the default
  set in parallel with the wasm.
- Get the font files reproducibly (pinned typst-assets version, e.g. from the crate source in
  the cargo registry via `cargo metadata`, or the GitHub tag `v0.15.1`) inside a mise task.
- Add `wasm-opt -Oz` (binaryen, pinned via mise) to `mise-tasks/build/engine`.
- Check what else is big (`twiggy` via mise if useful): e.g. hayagriva/citation styles, syntect
  syntaxes for raw highlighting, ICU data. Feature-gate where typst allows it; report findings.
- Report raw and gzip/brotli sizes before/after in the commit message.

## Acceptance
- `typst_engine_bg.wasm` raw size reported; target ≤ 12 MB raw, and gzip size reported.
- Fonts load as separate assets; default documents still render identically (vitest engine tests
  pass; add a test that compiles text in each default font family).
- `mise run build`, `mise run test:unit`, `mise run quality` green.
- ARCHITECTURE.md updated (engine section, known limitations).

## Out of scope
User-provided fonts UI; CDN hosting.
