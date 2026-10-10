# Shrink the engine wasm (41 MB → a few MB)

Status: done (branch task/engine-wasm-size)
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

## Result
- wasm 43.40 MB → 21.16 MB raw, 15.81 → 8.36 MB gzip, 10.57 → 6.20 MB brotli (q11).
  Fonts: 17 separate files, 9.68 MB raw / 6.40 MB gzip, fetched in parallel with the wasm.
- Target ≤ 12 MB raw is **not met**: after fonts (9.4 MB) and the name section (10.7 MB) are gone,
  code is 11.7 MB and data 9.4 MB, all reachable from typst-library without feature flags (see
  ARCHITECTURE.md, known limitations). `opt-level="z"` → 19.30 MB but ~40 % slower compiles
  (cold 170 → 247 ms, incremental 19 → 26 ms on a 60-section document); not adopted.
