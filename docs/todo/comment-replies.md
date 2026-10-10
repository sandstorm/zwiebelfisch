# Comment threads: replies with names and dates, Comment button in the Visual toolbar

Status: open — start after restructure-src is merged
Depends on: comments-drafting, comments-gutter (done), restructure-src
Touches: the margin-note syntax module, the notes gutter (cards), add-margin-note, the Visual toolbar

## Goal (user, 2026-10-10)
1. "Comments with replies, including names and dates."
2. "Comment button in the Tiptap editor control": the Comment action goes into the Visual view's
   formatting toolbar. Today it sits in the tab bar. Keep the shortcut (Mod+Alt+M). The Source view
   still needs a way to trigger it, so keep it reachable there (tab bar or the Source view's own controls).

## Decision: a thread is a list in the note, plain drafting, no helper code
```typst
#margin-note[Revenue 2025][
  - *Anna* (2026-10-10): Is this number still right?
  - *Bob* (2026-10-11): Yes, checked with finance.
]

// a first message without replies: still a list with one item, so the format is uniform
#margin-note[text][- *Anna* (2026-10-10): Is this right?]
```
- One list item per message: `*<name>* (<YYYY-MM-DD>): <text>`. The name comes from the widget's
  `user`, the date from the local date (date only, no time; the ISO format sorts and reads well
  in the PDF).
- Notes written by hand without this shape (plain text, or list items without author/date) still
  show and stay editable as one anonymous message. The editor never rewrites them unless a reply is added.
  Adding a reply to such a note turns the existing body into the first item without name/date
  (`- <text>`).
- Multi-paragraph reply text is kept on one list item (line breaks become `\` + newline, or
  continuation indentation; decide and test).

## UI (notes gutter card)
- The card shows the thread: each message with name (bold), date (muted) and text, oldest first.
  The first message is the note.
- A "Reply" box under the thread. Cmd/Ctrl+Enter sends, which appends a list item as one undo step.
- Own messages can be edited in place (pencil), and deleting the last own message is allowed. Others' messages
  are read-only (soft rule: same `user.name`, it is not a security boundary).
- "Resolve" removes the whole note as today (range notes keep their text).
- The card collapses long threads (show first + last 2, "n more").
- Collaboration: replies are text edits, so they merge through the Y.Text. Two people replying
  at once give two list items. Test that with the in-process Y.Doc helpers.

## Acceptance
- vitest: parse/print threads (round-trip exact for hand-written variants), add reply (minimal edit),
  edit own message, legacy note → thread on first reply, escaping of `]`, `*`, `#` in text;
  concurrent replies converge.
- vitest (jsdom): the toolbar has the Comment button (enabled with a selection or a caret in text),
  the card shows the thread, and a reply appends an item with name and date.
- Playwright (user-run): comment → reply as a second user in a collab room → both see the thread
  in the card and in the PDF margin.
