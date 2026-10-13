// The demo playground: the widget on one page, to try it out, for the e2e tests, and to write these docs in.
//
// Its whole state is the URL (playground.ts), so a reload, a second window or a shared link shows the same:
// `?example=simple|advanced|docs`, `?room=<name>` (Collaborate mode) or `?room=gitlab:demo/report@<branch>`
// (GitLab mode, a fake GitLab) on the local playground server (`mise run demo`), and `&user=<name>`. Without `room`
// (Local mode, the default and what the static e2e build uses) it never talks to a server. The shown file and the cursor's line are the URL's fragment (open-file-hash.ts, an
// extension of the demo's own). The playground bar above the editor switches all of this (playground-bar.ts).
//
// The Documentation example in Local mode saves to docs/ when the page comes from the dev server or vite preview
// (docs-files/plugin.ts). The static site (GitHub Pages, static-site.ts) opens that example, saves nothing and offers
// Local mode only. See docs/10_getting-started/01_getting-started.typ, "The demo".
import { collaboration, createTypstEditor, type ProjectFiles } from '../src';
import { connectDocsSync, type DocsSync } from './docs-files/docs-sync';
import { openFileHash } from './open-file-hash';
import { editorOptions, playgroundFromQuery, userQuery } from './playground';
import { renderPlaygroundBar } from './playground-bar';
import { probeServer, simulateUpstream } from './server-status';
import { readOnlyBanner, readOnlySave, STATIC_SITE } from './static-site';

const params = new URLSearchParams(location.search);
// The static site has no server to join, and is there to show these docs being edited.
if (STATIC_SITE && (params.has('room') || !params.has('example'))) {
  params.delete('room');
  if (!params.has('example')) params.set('example', 'docs');
  history.replaceState(null, '', `?${params}${location.hash}`);
}
const state = playgroundFromQuery(params);
// In a room the name goes into the URL, so a reload stays the same user and the second window is someone else.
if (state.room !== null && !params.has('user')) {
  params.set('user', state.user);
  history.replaceState(null, '', userQuery(state.user, params));
}

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
  // Local mode asks no server, so the editor is there at once.
  const server = state.mode === 'local' ? null : await probeServer();
  if (server) bar.setServer(server);
  const { files, collaboration: room } = editorOptions(state, server);
  const docs = state.example === 'docs' && state.mode === 'local' && !STATIC_SITE ? docsSync(files ?? {}) : null;
  const editor = createTypstEditor(document.getElementById('editor')!, {
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
  if (server) watchServer(server !== 'offline');
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
    const server = await probeServer();
    if (joined) bar.setServer(server === 'offline' ? 'lost' : server);
    else bar.setServer(server === 'offline' ? 'offline' : 'reload');
  }, 5000);
}
