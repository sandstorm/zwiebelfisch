# Inspector sidebar: edit what the Visual view does not show, for the current selection

Status: open (concept; decide the open questions first)
Depends on: restructure-src (lands in `features/inspector/`), comments-gutter (shares the right side)
Touches: src/visual-view/** (selection → context), new features/inspector/, widget layout, toolbar (things move out of it)

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

## Open questions
1. **Where it lives.** The widget is [editor | preview], and comments-gutter adds a notes column
   to the right of the text. Options:
   - (a) a third column between editor and preview, collapsible;
   - (b) a tab in the gutter column: "Notes | Inspector";
   - (c) a drawer over the preview.
   Recommendation: (b), one right-hand side panel for the editor, so the layout stays two
   columns plus a side panel.
2. Is it open by default, or does it open when the selection has hidden properties (badge on a toggle)?
3. Source view: show the Inspector there too (recommended, same contributors via the syntax tree)?

## Acceptance (once decided)
- A contributor API with tests; sections for image/figure, code block, link, alignment, generic
  call arguments and the document settings; edits are minimal source changes, each one undo step.
- Image tools and the code block language field use the Inspector (no duplicate UI).
- Playwright spec (user-run): select an image → set width/alt in the Inspector → source updated.
