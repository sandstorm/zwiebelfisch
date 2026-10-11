// The demo playground (docs/demo-playground.md). Its state is the URL:
// `?example=hello|simple|advanced`, `?room=<name>` (Collaborate mode) or
// `?room=gitlab:demo/report@<branch>` (GitLab mode) on the local playground
// server (`mise run demo`), `&user=<name>`. Without `room` (Local mode, the
// default and what the static e2e build uses) it never talks to a server.
// `&devtools` adds ProseMirror's dev tools to the Visual view (devtools.ts).
import { collaboration, createTypstEditor } from '../src';
import { devtools } from './devtools';
import { OpenFileHash } from './open-file-hash';
import { editorOptions, playgroundFromQuery, userQuery } from './playground';
import { renderPlaygroundBar } from './playground-bar';
import { probeServer, simulateUpstream } from './server-status';

const params = new URLSearchParams(location.search);
const state = playgroundFromQuery(params);
// In a room the name goes into the URL, so a reload stays the same user and the second window is someone else.
if (state.room !== null && !params.has('user')) {
  params.set('user', state.user);
  history.replaceState(null, '', userQuery(state.user, params));
}

const bar = renderPlaygroundBar(document.getElementById('playground')!, params, {
  navigate: (query) => location.assign(query),
  simulateUpstream: (change) => simulateUpstream(state.room!, change),
});

void start();

async function start(): Promise<void> {
  // Local mode asks no server, so the editor is there at once.
  const server = state.mode === 'local' ? null : await probeServer();
  if (server) bar.setServer(server);
  const hash = new OpenFileHash();
  const { files, collaboration: room } = editorOptions(state, server);
  const editor = createTypstEditor(document.getElementById('editor')!, {
    files,
    extensions: (builtins) => [...builtins, ...(room ? [collaboration(room)] : []), ...(params.has('devtools') ? [devtools()] : [])],
    user: { name: state.user },
    onOpen: (path) => hash.opened(path),
    onFilesChange: () => hash.filesChanged(),
  });
  hash.attach(editor);
  Object.assign(window, { editor });
  if (server) watchServer(server !== 'offline');
}

/** Keeps the status current while in a room (`joined`) or after falling back to the local copy. */
function watchServer(joined: boolean): void {
  setInterval(async () => {
    const server = await probeServer();
    if (joined) bar.setServer(server === 'offline' ? 'lost' : server);
    else bar.setServer(server === 'offline' ? 'offline' : 'reload');
  }, 5000);
}
