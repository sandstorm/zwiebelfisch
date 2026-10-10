#import "../helpers.typ": note, term

= Introduction <intro>

Writers want to see their document while they type. Classic typesetting
systems rebuild the whole document after every change, which takes seconds for
long texts. Typst instead compiles #term[incrementally]: it remembers what it
computed before and redoes only the parts an edit touches.

This report measures how much that matters in practice. @method describes the
setup, @results the numbers, and @fig:compile-times sums them up in one picture.

== Goals

+ Find out how compile time grows with the length of a document.
+ Compare a cold compile with an incremental one after a small edit.
+ Check that the preview stays responsive while typing.

#note[This document is itself a multi-file project: the template, the
chapters, a helper module and an SVG image are separate files. Open them in
the file panel on the left, or Ctrl+click a path such as `"template.typ"`.

Notes like this one and terms like #term[incrementally] are custom styles
declared in `helpers.typ`: pick them in the Visual view's text style menu.]
