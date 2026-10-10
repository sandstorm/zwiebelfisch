# Comment threads: replies with names and dates, Comment button in the Visual toolbar

Status: done (branch task/comment-replies)
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

## Outcome
- **Format** (`src/features/comments/note-thread.ts`, the only module that knows it; contract in
  ARCHITECTURE.md › Comments = margin notes › Threads): `readThread` / `addReply` / `editMessage` /
  `deleteMessage` / `localDate`, all on the note's markup.
  - **Decision, multi-line messages:** a line break is `\` + newline with the next line indented
    2 spaces deeper than the item's marker (a blank line is a paragraph break). Typst continues an
    item only on lines deeper than the marker's *column*, which is unknown for an item right after
    `[`. Hence: a one-line first message stays inline (`[- *Anna* (…): …]`, as specified), a
    multi-line one uses the block form (`[\n  - …\n]`), and a reply after an inline first item
    starts its own line at column 0 (`- *Anna* (…): a\n- *Bob* (…): b`), which Typst reads as the
    same list (checked with the CLI; the engine test compiles both layouts with drafting).
  - **Decision, minimal edits:** a reply is only an insertion after the last item, never a
    re-layout, so two concurrent replies merge into two items (vitest over in-process Y.Docs, both
    layouts). Converting a hand-written note on the first reply replaces the body (`- <text>\n- …`),
    so two people replying to the same *hand-written* note at once can duplicate its text.
  - **Decision, text semantics:** signed messages hold escaped plain text (`]`, `*`, `#`, `$`, … and
    line-start `-`, `+`, `=`, `/ `, `1.`); the card shows them unescaped. Unsigned messages (a
    hand-written note, or the first item after converting one) are markup, shown and edited as
    written through `safeNote`, exactly as before.
  - Without `user`, messages are signed "Anonymous". Deleting the only message removes the note.
- **Card** (`notes-gutter/note-card.ts`, split out of `notes-gutter.ts`): thread (bold name, muted
  date, text; >4 messages collapse to first + "n more" + last 2), reply box (Mod+Enter or the send
  button; the first message of an empty note is also sent on blur, like the old note field),
  pencil on own and unsigned messages, delete on the last own message, Resolve as before. One
  undo step per change. `VisualViewOptions.user`, `NotesGutterOptions.user`.
- **Comment button:** in the Visual toolbar (`VisualViewOptions.comment`, enabled with a caret or
  selection in text, not in code blocks); the tab-bar button stays for the Source view only
  (`EditingViews.addTabAction(element, mode)`); Ctrl/Cmd+Alt+M unchanged.
- **CSS guard** (asked alongside): `src/stylesheets.test.ts` parses every `.css` under `src/` with
  lightningcss 1.33.0 (added as an exact devDependency, the version vite already uses), error
  recovery off, fails on nested style rules and on unbalanced braces.
- **Tests:** vitest green (note-thread, notes-gutter incl. threads, toolbar Comment, editing views,
  CommentAction flow, engine compile, stylesheets); `mise run quality` green. Playwright:
  `tests/e2e/margin-notes.spec.ts` updated (toolbar button, signed messages, edit, reply, delete,
  Source-view button) and `collab.spec.ts` (+ reply as a second user, both see the thread and
  the PDF margin) — **not run** (sandbox): `mise run test:e2e`, `mise run test:e2e-collab`.
- **Follow-ups:** concurrent first replies to a hand-written note (above); message text is not
  rendered as markup in the card (signed text is plain anyway).
