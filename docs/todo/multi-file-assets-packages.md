# Multiple files, images and `@preview` packages

Status: open
Depends on: engine-wasm-size (touches the same engine files — coordinate or do after)
Touches: crates/typst-engine/src/world.rs, src/engine/**, src/preview/**, src/editor/** (API)

## Goal
Documents can `#include`/`#import` other `.typ` files, use `image("logo.png")`, and import
`@preview/...` packages. The widget API accepts a file map (text + binary) and a main path.

## Context
- Engine has `setBinary`/`remove`; the worker protocol currently only sends text files.
- Packages: fetch `https://packages.typst.org/preview/{name}-{version}.tar.gz` (in the worker,
  async before compile: compile → collect missing package errors → fetch → recompile; or a
  pre-scan of imports), untar in JS or Rust, register files under `VirtualRoot::Package(spec)`.
  Cache in IndexedDB / Cache API.
- Click-to-source for jumps into other files should report the path (already in `Jump`).

## Acceptance
- vitest: engine compiles a doc importing a second file and an image; package resolution test
  with a fixture tarball (no network in tests).
- Widget API documented in ARCHITECTURE.md.

## Out of scope
File tree UI (separate task later), uploading assets.
