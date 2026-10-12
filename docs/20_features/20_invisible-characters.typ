= Invisible characters <features-invisible-characters>
#set heading(outlined: false)

== What it does


Shows what is normally blank, as a word processor's formatting marks. The paragraph `Typst  is~fast.` (two spaces after "Typst") shows in the Visual editor as `Typst··is°fast.¶`.

- Visual editor: `·` for a space (each one, also several in a row), `°` for a non-breaking space (Typst `~`), `→` for a tab, `↵` for a line break (`\`), `¶` at the end of each paragraph and heading.
- Source editor, the code of raw boxes and text files: CodeMirror's marks for spaces and tabs.
- The marks are drawn in a faint color over the text; they are not part of it: they cannot be selected and are not copied, and the document does not change.
- On and off: "Invisible characters" in the View menu (checked while shown), or the command "Show invisible characters on / off" in search everywhere (@features-search-everywhere). Your choice is remembered in this browser.

== Why

Double spaces, a non-breaking space or a forced line break change the output but look like nothing in the text.

== How to configure

`invisibles.show`: `true` or `false` sets it for the viewer; unset, the viewer's last choice counts, else off (@reference-configuration-appearance).
