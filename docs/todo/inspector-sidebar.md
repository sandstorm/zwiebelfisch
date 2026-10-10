# Inspector sidebar: edit what the Visual view does not show, for the current selection

Status: open (placement decided 2026-10-10; dockview spike done: adopt later, build the side panel by hand behind a Layout module)
Depends on: restructure-src (lands in `features/inspector/`), comments-gutter (shares the right side)
Touches: src/features/visual-view/** (selection → context), new src/features/inspector/, widget layout, toolbar (things move out of it)

## Goal (user, 2026-10-10)
"We need some sidebar concept for the editor, which can edit non-visible things context-dependent
on the current selection." Typst documents carry a lot that the Visual view can't show inline.
Today each feature solves this on its own: image tools (width, alt, caption), the code block's
language field, link popovers (`field-popover.ts`), the "Numbered headings" toggle, and raw boxes
for everything else. One **Inspector** gathers this in a panel. It shows sections for the selection
and the things around it (innermost first), with document-wide settings at the bottom.

## Sketch
```
┌ Inspector ───────────────────────┐
│ Image  logo.svg                  │  ← selected node
│   Width   [ 50 %   ]  25 50 75 100│
│   Alt     [ Company logo        ]│
│   Caption [x]   Label [ fig:logo ]│
├──────────────────────────────────┤
│ Alignment  ◧ ▣ ◨ ☰               │  ← enclosing block(s)
├──────────────────────────────────┤
│ Document                         │  ← always: top-level set rules
│   Page   A4 ▾  margins 2.5cm     │
│   Font   Libertinus Serif 11pt   │
│   Headings numbered [1.1 ▾]      │
└──────────────────────────────────┘
```
- **Contributors:** each feature registers an inspector section,
  `{ applies(context) → bool, render(context, edit) }`. The context comes from the Visual
  selection (node + ancestors + marks) or the Source cursor (syntax node at the cursor via the
  Lezer tree), so the Inspector works in both views.
- **Edits** go through the same small source-edit modules as today (`image-call.ts` style: edit
  one argument of a call in place, minimal change, one undo step). Unknown arguments are shown
  read-only, or as a "raw arguments" field.
- **Generic fallback:** for any call the Visual view keeps as a raw box (`#pagebreak(weak: true)`,
  `#quote(attribution: ..)`, labels `<x>`), list its named arguments as editable fields, parsed from
  the call. This gives a lot of coverage for free.
- **Document section:** top-level `#set page/text/par/heading` rules as a form. The
  custom-styles concept (docs/2026_10_10_custom-styles.md, option b) builds on this.
- **What moves in:** the image toolbar's alt/width/caption, the code block language field,
  link URL editing, "Numbered headings" (from the toolbar), alignment (it can stay in the toolbar too).
  The toolbar keeps only frequent inline actions.

## Decisions (user, 2026-10-10)
1. **Placement:** one right-hand side panel for the editor with tabs **Notes | Inspector**, between
   the editor and the preview. The notes gutter cards (comments-gutter) stay aligned next to the
   text. The "Notes" tab lists all notes.
2. **Both views**, if it is easy: the Source view feeds the same sections from the Lezer node at
   the cursor. Otherwise start with the Visual view and keep the context interface view-neutral.
3. **Spike first: [dockview](https://dockview.dev/) as the general docking mechanism?** It is
   `dockview-core`: vanilla TypeScript, zero dependencies, with tabs, splits, drag & drop, floating
   panels and popouts. Panels would be Visual/Source, Preview, Notes, Inspector, Files (the file bar),
   and perhaps Diagnostics. Evaluate before building the panel layout by hand:
   - licence (the core must be MIT, no paid parts needed) and bundle size gzip, against our ~8 MB wasm;
   - **shadow DOM**: `<typst-editor>` renders into a shadow root. Do its CSS and drag & drop work
     there (stylesheet adoption, `document`-level listeners, popout windows)?
   - theming through CSS variables that match `--te-*`; small-width behaviour (embedding);
   - layout persistence (serialise per user; host option for a fixed default layout);
   - can the host restrict it (no docking for simple embeds: fixed two/three columns)?
   **Outcome (spike 2026-10-10, [docs/2026_10_10_dockview-spike.md](../2026_10_10_dockview-spike.md),
   branch `spike/dockview`): adopt later, not now.** The core is MIT, works in a shadow root since
   8.4.0 (2026-09-30), and has `toJSON`/`fromJSON`, `locked`/`disableDnd` and `--dv-*` variables
   that map onto `--te-*`. But it costs +88 KB gzip JS (+23 % of our main module) for a layout we can
   build by hand, its shadow-DOM support is two weeks old, features are moving into the paid
   `dockview-enterprise` (keyboard navigation between groups, auto-hide side bars), and it has no
   responsive collapse. So: build the Notes | Inspector side panel by hand behind a `Layout` module
   (panel ids, `show(id)`, opaque saved layout, host option `fixed | dockable`), and swap dockview in
   there when users need to rearrange or pop out panels.

## Acceptance (once decided)
- A contributor API with tests; sections for image/figure, code block, link, alignment, generic
  call arguments and the document settings; edits are minimal source changes, each one undo step.
- Image tools and the code block language field use the Inspector (no duplicate UI).
- Playwright spec (user-run): select an image → set width/alt in the Inspector → source updated.
