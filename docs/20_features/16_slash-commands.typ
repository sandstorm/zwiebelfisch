= Slash commands <features-slash-commands>
#set heading(outlined: false)

== What it does

#import "../template.typ": screenshot
#screenshot("slash-commands", width: 60%)

Type `/` in the Visual editor, at a line start or after a space, then part of a name: a list below the text offers what the Insert menu, the list and alignment buttons and the text style menu can do right there. Writing a report, `/table` on an empty line inserts a table, `/h2` makes the line a second-level heading, `/mermaid` asks for a new diagram file and puts its figure after the line.

- What it finds: entries whose name equals, starts with or contains what you typed, then those found by other words: `/spreadsheet` also finds "Insert table", `/123` finds "Numbered list", `/equation` finds "Inline math" and "Display math". Each row names its menu (Insert, List, Align, Text style, Block styles).
- Only what can apply at the cursor is listed: the same entries the menus enable there.
- ↑ / ↓ choose, Enter, Tab or a click runs it, Escape closes; the `/…` you typed goes. An entry that asks first ("Insert image", "Insert diagram") asks as its button does.
- No list in code: not in a code block, not in inline code. Nor after a letter (`and/or` stays text). The list closes when nothing matches.
- An empty line holding the cursor hints "Type / for commands" (not in headings, code blocks or table cells); the hint is not part of the text.
- The list grows with the extensions: what one adds to the Insert or text style menu (spreadsheets, diagrams, custom styles: @features-custom-styles) is found here, too.
- Typing `@` opens a list of the same kind, of the project's labels (@features-labels-and-references).

== Why

Inserting a table or a heading without leaving the keyboard or looking for a button, as in the word processors and wikis many writers know.

== How to configure

Nothing to configure. A host can leave out the extension `slash-commands` (@reference-embedding-extensions).
