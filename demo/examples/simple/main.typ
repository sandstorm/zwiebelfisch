#import "@preview/drafting:0.2.2": margin-note, set-margin-note-defaults
#set page(width: 16cm, height: auto, margin: (right: 4cm, rest: 1.5cm))
#set text(font: "Libertinus Serif", size: 12pt)
#show link: underline
#set-margin-note-defaults(
  stroke: rgb("#e0a800") + 0.5pt,
  fill: rgb("#fabe1447"),
  rect: (body, ..args) => rect(radius: 2pt, inset: 3pt, ..args, {
    set text(size: 8pt)
    set list(indent: 0pt, body-indent: 0.3em)
    body
  }),
)

= Typst in five minutes

Typst is a markup language for documents. Text is written as it is, and a few
characters add structure: *stars* make text strong, _underscores_ emphasise it,
and `backticks` show code.

#outline(title: [On this page], depth: 2)

== Writing in the Visual editor

The Visual tab edits this page like a word processor, the Source tab shows its
Typst. In the Visual editor, a few keys do the markup for you:

- `# ` at the start of a line makes a heading, `## ` a smaller one.
- `- ` starts a bullet list, `1. ` a numbered one, `> ` a quote.
- Text typed between backticks becomes code. Ctrl+B and Ctrl+I make text strong
  or emphasised (Cmd on a Mac).
- `/` opens the commands: try `/table`, `/h2` or `/quote`.
- `@` lists the labels to refer to, like a heading or a figure.
- Shift twice searches everywhere. The question mark on the left opens a cheat
  sheet.

== Lists

Bullets start with a dash, numbered items with a plus:

- Write the text first.
- Style it later with `#set` rules.
  - Lists can be nested by indenting.

+ Open the editor.
+ Type something.
+ Watch the preview update.

== Math

Inline math sits in dollar signs, like $a^2 + b^2 = c^2$. With spaces inside the
dollar signs, an equation gets its own line:

$ integral_0^1 x^2 dif x = 1 / 3 $

== A link and a table

The full reference lives at #link("https://typst.app/docs")[typst.app/docs].

#table(
  columns: 3,
  align: (left, center, right),
  table.header([*Markup*], [*Result*], [*Use*]),
  [`*strong*`], [*strong*], [important words],
  [`_emph_`], [_emph_], [stress],
  [`= Title`], [heading], [structure],
)

== Everything the Visual editor edits

Headings, strong and emphasised text, code, lists, the link and the table above
are all edited in place. So is each of these; try changing one:

#quote(block: true)[A quote stands apart from the text around it.]

```typ
#set text(lang: "en") // a code block
```

#import "@preview/cheq:0.4.0": checklist
#show: checklist

- [x] Read this page.
- [ ] Tick this box in the Visual editor.

#align(center)[A centred line: the Align menu sets it.]

#line(length: 100%)

Above is a rule: type `---` on an empty line. Ctrl+Enter (Cmd+Enter on a Mac)
adds a page break; this example has none, it is one long page. The table of
contents at the top, the figures below with their captions, and references like
@fig:workflow are edited in place, too.

Everything else is a raw box: math like $e^(i pi) + 1 = 0$, or a call like
#text(fill: olive)[this one] shows its compiled look, and its code once you
click it.

== Custom styles

#import "styles.typ": key, tip

`styles.typ` declares two styles of its own: a block style, Tip, and an inline
one, Key. Press #key[Shift] twice to search everywhere.

#tip[Select some text and pick a style from the text style menu; "New style…"
adds one to `styles.typ`.]

== A spreadsheet as a table

#import "data/budget.ic.gen.typ": sheets, values

The trip in @tab:budget costs #values.Budget.at(4).at(1) € in total. Open
`data/budget.ic` to edit it in the spreadsheet editor: the table and the total
here follow.

#figure(
  sheets.Budget,
  caption: [A trip budget, computed in `data/budget.ic`.],
) <tab:budget>

== Diagrams

@fig:workflow is a Mermaid diagram, drawn from the text in
`diagrams/workflow.mmd`. Open that file, or Ctrl+click the picture
(Cmd-click on a Mac).

#import "@preview/merman:0.4.0": mermaid

#figure(
  mermaid(read("diagrams/workflow.mmd"), width: 35%),
  caption: [Writing, Mermaid style.],
) <fig:workflow>

@fig:editor is a draw.io diagram: a PNG with the diagram inside. Ctrl+click the
picture (Cmd-click on a Mac) to edit it in diagrams.net.

#figure(
  image("diagrams/editor.drawio.png", width: 100%),
  caption: [What happens while you type.],
) <fig:editor>

== Comments

#margin-note[Comments are notes in the margin, kept in the text itself.][- *Ada* (2026-10-10): Where do I find them?
- *Grace* (2026-10-11): Hover the note in the margin, or open the comments column.]
Select some text and press Ctrl+Alt+M (Cmd+Option+M on a Mac) to add
one; replies make a thread.
