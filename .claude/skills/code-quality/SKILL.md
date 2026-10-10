---
name: code-quality
description: Track and enforce code quality in this repo — complexity metrics (cyclomatic, cognitive, nesting, function length, params) plus an APOSD design review (deep modules, information hiding). Use after implementing a feature, before committing larger changes, when refactoring, or when the user asks about code quality, complexity, hot spots or "is this well designed?".
---

# Code quality

Two halves: **measure** (mechanical metrics, cheap, every change) and **judge** (APOSD design
review, for anything that adds or reshapes a module).

## 1. Measure

```bash
mise run quality          # lint gate: fails on any metric above threshold
mise run quality:report   # hot-spot table: every function ranked by cognitive/cyclomatic complexity
```

Thresholds live in `eslint.config.js` (single source of truth — do not restate them elsewhere):

| Metric | Rule | Why it matters |
|---|---|---|
| Cognitive complexity | `sonarjs/cognitive-complexity` | how hard a function is to *read* (nesting-weighted) |
| Cyclomatic complexity | `complexity` | number of paths → test burden |
| Nesting depth | `max-depth` | deep nesting hides the happy path |
| Function length | `max-lines-per-function` | long functions usually do several things |
| Parameters | `max-params` | many params = leaky interface; pass an options object or split |

Workflow:

1. Run `mise run quality:report` before and after a change; mention the delta for touched files
   when it moves noticeably.
2. A threshold violation is fixed, not suppressed. If a suppression is truly warranted (e.g. a
   flat `switch` over syntax-node kinds, which inflates cyclomatic but not cognitive complexity),
   use a scoped `// eslint-disable-next-line <rule> -- <reason>` with the reason.
3. Never raise a threshold to make a change pass without the user agreeing.

Metrics catch *local* complexity only. A codebase of tiny functions can still be badly designed —
that is what step 2 is for.

## 2. Judge (APOSD)

For new or reshaped modules, review against *A Philosophy of Software Design*. If the
`sandstorm-codereview` skill is available, use it — it encodes the same guidelines. Otherwise check:

- **Deep modules**: is the interface much simpler than the implementation? Flag pass-through
  methods, thin wrappers, classes that only forward to one collaborator.
- **Information hiding**: does knowledge of a format/protocol/library live in exactly one module?
  (e.g. only `Preview` knows about typst.ts, workers and vector deltas; only `VisualView` knows
  ProseMirror.) Leakage = the same detail in two places.
- **General-purpose interfaces**: somewhat general interfaces, specialised implementations.
- **Pull complexity down**: callers should not have to configure or sequence internals.
- **Define errors out of existence** where semantics allow (e.g. `reveal(range)` clamps instead of throwing).
- **Comments**: interface comments say *what and why*, not *how*; no comment restating the code.
- **Names**: precise, consistent; same concept → same name across modules.

Report findings as: file:line, the principle, the concrete consequence, a suggested restructuring.
Then fix what is in scope and list the rest.
