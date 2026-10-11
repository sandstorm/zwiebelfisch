#import "@preview/merman:0.4.0": mermaid

= Method <method>

We generated documents of 1 to 100 pages, each page holding a heading, two
paragraphs and an equation. Every document was compiled once from scratch and
then again after changing a single word on its last page.

== Measuring

The time per compile is the median $tilde(t)$ of $n$ runs. For a document of
$p$ pages, the speed-up of an incremental compile is

$ s(p) = (t_"cold" (p)) / (t_"incremental" (p)) $ <eq:speedup>

and @eq:speedup is reported for every document length. @fig:measurement shows
the loop; its Mermaid source is `diagrams/measurement.mmd`.

#figure(
  mermaid(read("../diagrams/measurement.mmd"), width: 100%),
  caption: [One round of the measurement, per document size.],
) <fig:measurement>

In code, the loop is short:

```ts
for (const pages of [1, 10, 50, 100]) {
  engine.setSource('/main.typ', generate(pages));
  const cold = time(() => engine.compile('/main.typ'));
  engine.setSource('/main.typ', editLastWord(generate(pages)));
  const incremental = time(() => engine.compile('/main.typ'));
  report(pages, cold, incremental);
}
```
