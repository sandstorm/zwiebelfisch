// The demo playground (docs/30_architecture/11_development.typ). Its state is the URL:
// `?example=hello|simple|advanced|docs`, `?room=<name>` (Collaborate mode) or
// `?room=gitlab:demo/report@<branch>` (GitLab mode) on the local playground
// server (`mise run demo`), `&user=<name>`. Without `room` (Local mode, the
// default and what the static e2e build uses) it never talks to a server.
// `&devtools` adds the devtools side panel (the library's optional `devtools`). The Documentation example in Local
// mode saves to docs/ when the page comes from the dev server or vite preview (docs-files/).
import { collaboration, createTypstEditor, devtools, type ProjectFiles } from '../src';
import { connectDocsSync, type DocsSync } from './docs-files/docs-sync';
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
  // the open file (the hash) stays open
  navigate: (query) => location.assign(query + location.hash),
  simulateUpstream: (change) => simulateUpstream(state.room!, change),
});

void start();

async function start(): Promise<void> {
  // Local mode asks no server, so the editor is there at once.
  const server = state.mode === 'local' ? null : await probeServer();
  if (server) bar.setServer(server);
  const hash = new OpenFileHash();
  const { files, collaboration: room } = editorOptions(state, server);
  const docs = state.example === 'docs' && state.mode === 'local' ? docsSync(files ?? {}) : null;
  const editor = createTypstEditor(document.getElementById('editor')!, {
    files,
    extensions: (builtinExtensions) => {
      const extensions = [...builtinExtensions, ...(room ? [collaboration(room)] : [])];
      return state.devtools ? devtools(extensions) : extensions;
    },
    user: { name: state.user },
    onOpen: (path) => hash.opened(path),
    allowFileChange: (change) => docs?.allowFileChange(change) ?? true,
    onFilesChange: (change) => {
      hash.filesChanged();
      docs?.filesChanged(change);
    },
  });
  hash.attach(editor);
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
