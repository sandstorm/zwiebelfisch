= Code blocks <features-code-blocks>
#set heading(outlined: false)

== What it does

Code in the text is Typst's raw text: inline between backticks, as a block between three backticks with a language.

````typ
Run `typst compile` for each document:

```sh
for n in 1 10 100; do typst compile "doc-$n.typ"; done
```
````

- The preview shows the block highlighted for its language, as Typst does; the inline code in a monospace font.
- The Visual editor shows inline code in a monospace font, and a block as plain monospace text under a header with a field for its language.
- Inline code: Ctrl+E (⌘E on Mac), "Code" in the bar over a selection, or type it between backticks.
- Code block: Insert → Code block, or type ```` ``` ```` and a space at a line start (```` ```sh ```` and a space: with its language). Tab / Shift+Tab indent / outdent by two spaces.
- The Visual editor does not check its spelling (@features-spelling).

== How to configure

Nothing to configure.
