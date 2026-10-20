// The demo playground: the widget on one page, used
// - to try it out
// - by the e2e tests
// - to write these docs in
//
// Its whole state is the URL, so a reload, a second window or a shared link shows the same:
// - `?example=simple|advanced|docs`
// - `?room=<name>` (Collaborate mode) or `?room=gitlab:demo/report@<branch>` (GitLab mode, a fake GitLab) on the
//   local playground server (`mise run demo`); without `room` (Local mode) it never talks to a server
// - `&user=<name>`: the name in Local mode
// - the fragment: the shown file and the cursor's line
//
// The Documentation example in Local mode saves to docs/ when the page comes from the dev server or vite preview.
// The static site (GitHub Pages) saves nothing and offers Local mode only.

import { collaboration, createEditor, type ProjectFiles } from '../src';
import { connectDocsSync, type DocsSync } from './docs-files/docs-sync';
import { isContract } from './examples';
import { openFileHash } from './open-file-hash';
import { editorOptions, playgroundFromQuery } from './playground';
import { renderPlaygroundBar } from './playground-bar';
import { probeServer, simulateUpstream, type ServerProbe } from './server-status';
import { readOnlyBanner, readOnlySave, STATIC_SITE } from './static-site';

const params = new URLSearchParams(location.search);
// The static site has no server to join, and is there to show these docs being edited.
if (STATIC_SITE && (params.has('room') || !params.has('example'))) {
  params.delete('room');
  if (!params.has('example')) params.set('example', 'docs');
  history.replaceState(null, '', `?${params}${location.hash}`);
}
const state = playgroundFromQuery(params);

const bar = renderPlaygroundBar(
  document.getElementById('playground')!,
  params,
  {
    // the open file (the hash) stays open
    navigate: (query) => location.assign(query + location.hash),
    simulateUpstream: (change) => simulateUpstream(state.room!, change),
  },
  { server: !STATIC_SITE },
);
if (STATIC_SITE) document.body.prepend(readOnlyBanner(document));

void start();

async function start(): Promise<void> {
  const server = await probe();
  const { files, collaboration: room } = editorOptions(state, server?.kind ?? null);
  const docs = state.example === 'docs' && state.mode === 'local' && !STATIC_SITE ? docsSync(files ?? {}) : null;
  const editor = createEditor(document.getElementById('editor')!, {
    files,
    extensions: (builtinExtensions) => [
      ...builtinExtensions,
      openFileHash(),
      ...(room ? [collaboration(room)] : []),
      ...(STATIC_SITE ? [readOnlySave()] : []),
    ],
    user: { name: state.user },
    allowFileChange: (change) => (isContract(change.path) ? true : (docs?.allowFileChange(change) ?? true)),
  });
  if (docs) editor.onDidChangeFiles((change) => isContract(change.path) || docs.filesChanged(change));
  docs?.attach(editor);
  Object.assign(window, { editor });
  if (server) watchServer(server.kind !== 'offline');
}

/** What the server offers, shown in the bar; null in Local mode, which asks no server, so the editor is there at once. */
async function probe(): Promise<ServerProbe | null> {
  if (state.mode === 'local') return null;
  const server = await probeServer();
  bar.setServer(server.kind, server.plainRooms);
  return server;
}

/**
 * The docs example's saving to docs/ (dev server, vite preview), or null and a line saying that nothing is saved
 * (static build). The contracts are not in docs/: the sync never sees them, so a snapshot of docs/ keeps them.
 */
function docsSync(files: ProjectFiles): DocsSync | null {
  const inDocs = Object.fromEntries(Object.entries(files).filter(([path]) => !isContract(path)));
  const sync = connectDocsSync(inDocs, (text, level) => bar.setSaveStatus(text, level));
  bar.setSaveStatus(sync ? 'Edits are saved to docs/' : 'Edits are not saved (static build; mise run demo saves them to docs/)', 'muted');
  return sync;
}

/** Keeps the status current while in a room (`joined`) or after falling back to the local copy. */
function watchServer(joined: boolean): void {
  setInterval(async () => {
    const { kind, plainRooms } = await probeServer();
    if (joined) bar.setServer(kind === 'offline' ? 'lost' : kind, plainRooms);
    else bar.setServer(kind === 'offline' ? 'offline' : 'reload', plainRooms);
  }, 5000);
}
