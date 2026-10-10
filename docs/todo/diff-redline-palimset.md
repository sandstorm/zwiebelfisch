# Redline preview with palimset (Typst-rendered track changes)

Status: open
Depends on: diff-rendering (done), multi-file-assets-packages
Touches: src/editor/change-tracking.ts, src/preview/** (compile entry), src/engine/fixtures/**

## Goal
"Show changes" today marks the *editors* (Source/Visual) and draws change bars in the preview
margin. Readers of the PDF still have to guess *what* changed on a page. Evaluate
[`@preview/palimset:0.1.0`](https://typst.app/universe/package/palimset/) for a **redline
preview**: the preview compiles a generated wrapper instead of `main`:

```typst
#import "@preview/palimset:0.1.0": diff-content
#diff-content(include "/.base/main.typ", include "/main.typ")
```

The base text (`ChangeTracking` base / GitLab `meta.base`) is mounted as virtual files under
`/.base/…`. Insertions render blue bold, deletions red struck-through, typeset by Typst
itself. It can also be exported as a "changes" PDF.

## API (0.1.0)
`diff-string(a, b, format-plus:, format-minus:, split-regex: "[^A-Za-z0-9]")`,
`diff-content(a, b, …same…)`. Diffs content trees word-wise. Formatting is customisable,
e.g. to match the editors' insert/delete colours.

## Questions to answer first (spike)
- Quality on real documents: headings, lists, tables, math, figures, `#show` rules, page
  breaks. What does diff-content do with structurally changed content (it is 0.1.0)?
- Compile time on a 20-page document (the diff runs in Typst, on every keystroke while shown).
- Multi-file: `include` of chapters inside main. Do base and current includes resolve to the
  right `/.base/` paths? (Probably needs the whole base project mounted.)
- Click-to-jump (`jumpFromPosition`) in the redline: positions land in the wrapper or
  in the current file? Inserted text should still jump. Deleted text can't jump.
- Does it replace the change bars, or is it a separate mode ("Changes: off / marks / redline")?

## Acceptance
- Spike notes in this file with screenshots or a sample and a recommendation.
- If it is adopted: vitest compiles the wrapper with a palimset fixture, and a Playwright spec toggles
  redline and sees an inserted word styled in the preview.

## Out of scope
Suggesting mode. Diff of non-Typst assets.
