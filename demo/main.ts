// The demo playground: the widget on one page, to try it out, for the e2e tests, and to write these docs in.
//
// Its whole state is the URL (playground.ts), so a reload, a second window or a shared link shows the same:
// `?example=simple|advanced|docs`, `?room=<name>` (Collaborate mode) or `?room=gitlab:demo/report@<branch>`
// (GitLab mode, a fake GitLab) on the local playground server (`mise run demo`, which signs people in at its fake
// GitLab: the widget's status bar has "Sign in"), and `&user=<name>` (Local mode). Without `room`
// (Local mode, the default and what the static e2e build uses) it never talks to a server. The shown file and the cursor's line are the URL's fragment (open-file-hash.ts, an
// extension of the demo's own). The playground bar above the editor switches all of this (playground-bar.ts).
//
// The Documentation example in Local mode saves to docs/ when the page comes from the dev server or vite preview
// (docs-files/plugin.ts). The static site (GitHub Pages, static-site.ts) opens that example, saves nothing and offers
// Local mode only. See docs/10_getting-started/01_getting-started.typ, "The demo".
import { collaboration, createEditor, type ProjectFiles } from '../src';
import { connectDocsSync, type DocsSync } from './docs-files/docs-sync';
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
    allowFileChange: (change) => docs?.allowFileChange(change) ?? true,
  });
  if (docs) editor.onDidChangeFiles((change) => docs.filesChanged(change));
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

/** The docs example's saving to docs/ (dev server, vite preview), or null and a line saying that nothing is saved (static build). */
function docsSync(files: ProjectFiles): DocsSync | null {
  const sync = connectDocsSync(files, (text, level) => bar.setSaveStatus(text, level));
  bar.setSaveStatus(sync ? 'Edits are saved to docs/' : 'Edits are not saved (static build; mise run demo or demo:build saves them to docs/)', 'muted');
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
