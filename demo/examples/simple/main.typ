#set page(width: 16cm, height: auto, margin: 1.5cm)
#set text(font: "Libertinus Serif", size: 12pt)
#show link: underline

= Typst in five minutes

Typst is a markup language for documents. Text is written as it is, and a few
characters add structure: *stars* make text strong, _underscores_ emphasise it,
and `backticks` show code.

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
