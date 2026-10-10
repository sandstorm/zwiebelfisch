#import "template.typ": template

#show: template.with(
  title: "Typesetting at the Speed of Thought",
  subtitle: "A short report on incremental document compilation",
  authors: ("Ada Example", "Grace Sample"),
  date: datetime(year: 2026, month: 10, day: 10),
)

#outline(depth: 2)

#pagebreak()

#include "chapters/introduction.typ"
#include "chapters/method.typ"
#include "chapters/results.typ"
