= Labels and cross-references <features-labels-and-references>
#set heading(outlined: false)

== What it does

A label names a heading, figure or table; a reference to it shows its number in the preview and leads there in the editors.

```typ
= Results <results>
@tab:timings lists the medians; @fig:setup shows the setup.
```

The Visual editor shows `results` as a tag on the heading and each reference as a chip naming its target; the preview shows "Table 1" and "Figure 1".

- Insert → Add label: type the name into a new tag (`fig:`, `tab:` or `sec:` to start with).
- Select text in a block without a label: the selection's bar offers Add label, too.
- Click a tag: "Rename…" (updates the references in every file), "Rename without updating references…", "Remove label".
- Type `@` for a list of the project's labels, found by name or by what they label. Enter, Tab or a click inserts the reference; so does a space or punctuation right after a whole name (`@intro.`).
- A reference to a missing label is marked.
- A reference, and `#link(<label>)[..]`, leads to its label, in whichever file: hovering says where ("Go to Figure · The measurement setup in method.typ (⌘+click or Alt+Enter)"); Ctrl+click (⌘-click on Mac) on it, or Alt+Enter on the selected chip or with the cursor in it, opens that file at the label. In the Source editor and the Visual editor alike; a plain click edits.
- Copy and paste never makes two labels of one name: a pasted label the project has already gets `-1`, `-2`, … (`<fig:setup-1>`), and the references to it inside the pasted text (`@fig:setup-1`) with it; references to labels not pasted keep pointing to the originals. A cut and pasted label keeps its name.
- Search everywhere finds labels and figures: `@` and part of a name or caption (@features-search-everywhere).

== How to configure

Nothing to configure.
