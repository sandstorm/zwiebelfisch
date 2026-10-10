# Collaboration server: Node, Rust or Go?

Date: 2026-10-10. Concept only, no decision yet. Question from the user: "Is the collab server
required in Node? I would prefer Go as server side (or Rust)."

## 1. What the server does today

`server/` is about 1,400 lines of TypeScript on Hocuspocus 4 (`@hocuspocus/server`), plus SQLite
storage (`@hocuspocus/extension-sqlite`), `yjs` and `node-diff3`.

| Job | Where | Needs to understand Yjs content? |
|---|---|---|
| Relay a room's Yjs updates and awareness (carets) between clients | Hocuspocus | no: it only merges updates into the room's doc |
| Authenticate (`onAuthenticate`, a shared token today) | `auth.ts` | no |
| Store every room's Yjs state (SQLite, debounced) and load it again | Hocuspocus SQLite extension | no: state as bytes |
| **GitLab rooms** (`gitlab:<project>@<branch>`): load a branch into the doc, commit "Save version", merge upstream pushes (3-way, `node-diff3`), report conflicts | `gitlab/*.ts` | **yes**: it reads and edits the `files` map (Y.Text per `.typ` file), `assets` and `meta` |
| Stateless messages (save, pull, results) and HTTP (GitLab webhook, playground endpoints) | Hocuspocus hooks | no |
| Fake GitLab and playground for development and e2e tests | `gitlab/fake-gitlab.ts`, `playground/` | no |

The widget connects with `@hocuspocus/provider`, so the server must speak the **Hocuspocus
protocol**. That protocol is y-sync and awareness, with the document name in front of every
message, plus auth and stateless messages. The message types of GitLab rooms are shared with the
widget through `src/features/collaboration/gitlab-protocol.ts`.

So Node is not required by the protocol. Two parts tie the server to a language:
- **A Yjs implementation.** Plain rooms could almost treat documents as opaque bytes, but
  GitLab rooms must read and write the texts.
- **The Hocuspocus protocol**, or switching the widget to the plain y-websocket protocol, which
  would lose stateless messages and auth (both used).

## 2. Options

### (A) Stay on Node

- **Pro:** It works and is tested. It has the least code, because Hocuspocus does relay,
  storage, auth and hooks. Types are shared with the widget (`gitlab-protocol.ts`), and server
  tests run in the same vitest setup.
- **Con:** It is a Node runtime to operate, and not the stack the team prefers. Memory per room
  is that of JS Yjs docs, which is fine at our scale.

### (B) Rust: `yrs`

- **Yjs:** [`yrs`](https://github.com/y-crdt/y-crdt) is the Rust port from the y-crdt project,
  the Yjs ecosystem's own port. It is binary-compatible with Yjs (v1 and v2 updates) and has been
  in production use for years (also behind `y-py` and `ywasm`).
- **Protocol:** y-sync ships in `yrs`, and there are server crates for it (`yrs-axum`,
  `yrs-tokio`, `yrs-warp`). For Hocuspocus there is
  [`hocuspocus-rs`](https://crates.io/crates/hocuspocus-rs). Otherwise we write the envelope
  ourselves: it is small (document name, message type, auth, stateless; see the provider source).
- **The rest:** axum or tokio-tungstenite, `rusqlite`, `reqwest` for the GitLab API, and a 3-way
  merge such as `diffy`.
- **Fit:** We already build Rust (the Typst engine crate, mise has the toolchain). The server
  becomes one static binary.
- **Con:** It is the most porting effort. All server code and its tests (gitlab-rooms, merge,
  commit-actions, playground) have to be rewritten, including the fake GitLab. The message types
  are no longer shared with the widget: they must be kept in sync by hand, or generated from a
  schema (JSON Schema → TS + serde).

### (C) Go: one of the new Yjs ports

- **Yjs:** Go got several ports in 2025–26: [`ygo`](https://github.com/reearth/ygo) (and forks
  that claim byte-for-byte wire compatibility with yjs 13.6 plus a Hocuspocus-compatible server
  with SQLite) and [`go-yjs`](https://github.com/antst/go-yjs).
- **Pro:** Go is easy to operate, and if the team runs Go services this is the most familiar.
  A port that ships a Hocuspocus-compatible server would cover relay, storage and auth.
- **Con:** The ports are young, and there are several competing forks. That means risk: Y.Text
  edge cases, garbage collection, long-term maintenance. Their wire compatibility is claimed but
  not yet proven in our setup. 3-way merge needs a library (several exist). The porting effort is
  the same as for Rust.

### (D) Split: relay in Rust or Go, GitLab logic in a small worker

Plain rooms need no Yjs content logic, so any language with a y-sync relay could serve them.
GitLab rooms could stay in Node as a worker that opens the room as a client. That gives two
runtimes again, so it is only worth it as a step in a migration.

## 3. Comparison

| | Node (A) | Rust (B) | Go (C) |
|---|---|---|---|
| Yjs implementation | reference (`yjs`) | `yrs`, mature, from the Yjs ecosystem | young ports, several forks |
| Hocuspocus protocol | built in | `hocuspocus-rs` or own envelope (small) | in some ygo forks, or own envelope |
| Porting effort | none | high (≈1,400 lines + tests + fake GitLab) | high (same) |
| Shared types with the widget | yes | no (schema or by hand) | no (schema or by hand) |
| Operating | Node process | one static binary | one static binary |
| Fit with the repo | server/ next to the widget | Rust already used (engine) | new language in the repo |

## 4. Recommendation (if we move)

1. **Decide on operations first.** If the team runs Go and nothing else, (C) is attractive, but
   only after the spike below. Otherwise **(B) Rust**: the mature Yjs port and a language the
   repo already uses.
2. **Spike before deciding (2–3 days), the same task in Rust and in Go:** a server that speaks
   the Hocuspocus protocol for plain rooms (sync, awareness, auth token, SQLite storage), run
   against our existing `collab.spec.ts` e2e test, which is unchanged since the client stays the
   same. Then one GitLab operation: load a branch into `files`, then apply a text edit to a Y.Text
   and see it in the browser.
3. **Then migrate in steps:**
   - plain rooms, with the e2e test as the contract;
   - GitLab rooms (load, save, pull with merge) with the existing rooms tests ported;
   - the fake GitLab and the playground (or keep the fake GitLab as a Node test helper; it is
     only an HTTP stub);
   - the shared message types: one JSON Schema, generating TS and Rust or Go types.
4. **Until then nothing blocks:** the widget only depends on the protocol, not on the server's
   language.

## Open questions for the user
- Who runs the server in production, and which stack do they operate today (Go, Rust, Node)?
- Is "single binary" the main reason, or performance, or team skills? That decides between B and C.
- Should the spike be scheduled now, or after the editor features settle?
