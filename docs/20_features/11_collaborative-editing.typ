= Collaborative editing <features-collaborative-editing>
#set heading(outlined: false)

== What it does


Several people edit the same project at once. Ada writes the method chapter while Bob fixes the introduction: each sees the other's cursor with a name, the other's edits as they type, and in the file panel the initials of who is in which file.

- The text of every `.typ` file is shared, with create, rename and delete. Margin notes are text, so comments are shared too.
- Images and other files are shared only in GitLab rooms. Elsewhere each editor keeps the files it was given.
- Cursors and selections, with each user's name and color.
- Undo reverts only your own edits.
- Until the room has synced, the editing area shows "Connecting to the room…" and takes no input.

Trying it: in the demo, pick "Collaborate" in the playground bar, then "Open a second window as Bob".

== Why

Co-authors and reviewers work in one document at the same time instead of mailing versions around and merging them by hand.

== How to configure

The host adds the `collaboration` extension with a connection (a Hocuspocus server such as this repository's, or a `Y.Doc` of its own) and sets `user` (name, cursor color): @configuration-collaboration-server.
