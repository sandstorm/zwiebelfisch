= Bidirectional navigation <features-bidirectional-navigation>
#set heading(outlined: false)

== What it does

#import "../template.typ": screenshot
#screenshot("bidirectional-navigation")

The editors and the preview show the same place, both ways. Reading page 12 of the preview, a click on a typo there puts the cursor on it in the editor, opening its chapter's file if needed; writing in a chapter, the preview scrolls along.

- *Preview → editor:* a click on text in the preview selects that text in the editor, opening its file if needed. The preview outlines what the click selected until the next edit or until the selection moves away.
- *Editor → preview:* "Follow cursor" (preview toolbar): the preview scrolls to the text being edited when it moves off-screen.
- Selected text (either editor) is shaded in the preview, too; a caret shades nothing.
- Following a reference or link (@features-labels-and-references) scrolls the preview to its target as well.

== Why

A long document is read in the preview and fixed in the text; neither has to be searched for the other.

== How to configure

Settings (@reference-configuration-preview):

- `previewSync.followCursor`: whether the preview follows the cursor, as "Follow cursor" in its toolbar. Unset: what this viewer chose last, else on.
- `previewSync.highlightSelection` (on by default): whether the selection is shaded in the preview.
