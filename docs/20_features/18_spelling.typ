= Spelling <features-spelling>
#set heading(outlined: false)

== What it does

The browser checks the spelling of the Visual editor's text with its own checker and dictionaries; its context menu offers the corrections. In a document starting with

```typ
#set text(lang: "de", region: "AT")
```

the words are checked as Austrian German.

- The language is the document's: the first `#set text(lang: ..)` in the shown file, else in the main file, with its `region`. Without one, the browser's default language.
- Code is not checked: inline code, code blocks and raw boxes (math, labels, other Typst). Neither is the Source editor.
- The browser knows no project words: what it flags wrongly, it flags in every document.

== How to configure

`spellcheck.enabled` (on by default) turns it off (@reference-configuration-writing).
