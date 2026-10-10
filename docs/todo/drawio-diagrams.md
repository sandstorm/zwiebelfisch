# Diagrams: `.drawio.png` edited with the diagrams.net editor

Status: open (long term; asked for on 2026-10-10)
Depends on: ironcalc (shares the "a file kind opens in its own embedded editor" pattern and binary file updates)
Touches: src/features/files (asset view → editor per file kind), a new src/features/diagrams/, src/core/project/paths.ts (file kind), CSS, ARCHITECTURE.md, docs/embedding.md

## Goal
People draw diagrams in the editor and use them in the document as ordinary images:
`#image("diagrams/architecture.drawio.png")`. A `.drawio.png` is a PNG with the diagram's
XML embedded in it, so Typst shows it as an image and diagrams.net can open it again for editing.

- Opening a `.drawio.png` in the file panel shows the **diagrams.net editor**, embedded in
  an iframe (`https://embed.diagrams.net/?embed=1&proto=json&…`). Saving writes the exported
  PNG with the XML back into the project file, and the preview updates.
- "New diagram…" creates an empty `.drawio.png`.
- In the Visual view, an image box showing a `.drawio.png` offers "Edit diagram".

## Context
- The diagrams.net **embed mode** speaks a JSON `postMessage` protocol:
  - the editor sends `init`; the host sends `load` with the XML or PNG data URI;
  - `save` and `exit` come back;
  - `export` with `format: 'xmlpng'` returns a PNG data URI that has the diagram embedded.
  
  See https://www.drawio.com/doc/faq/embed-mode.
- It needs network access to embed.diagrams.net, or a self-hosted copy (the drawio webapp is
  Apache-2.0). Offer a host option for the editor URL.
- Binary updates of project files exist (`Project.apply({ kind: 'update', content: Uint8Array })`,
  added for spreadsheets).
- Collaboration: binary files are not merged; the last save wins, as for images today.

## Acceptance (sketch)
- vitest: the postMessage handshake (`init` → `load`, `export` → project update) with a fake
  iframe window. PNG round trip: the embedded XML survives.
- Playwright (needs a browser and network, or a stub page that speaks the protocol): open a
  diagram, save, and see the preview update.

## Out of scope
- `.drawio` / `.svg` variants (they could follow the same path).
- Real-time co-editing of a diagram.
