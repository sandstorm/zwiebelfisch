// The local editor (/local#<token>), which `zwiebelfisch [path]` opens: the widget on that folder's files, written
// straight to disk.

import { createEditor, type Extension } from '../../src';
import { el } from '../dom';
import { LocalFolder } from './local-folder';

const host = document.getElementById('editor')!;
const folder = new LocalFolder(location.hash.slice(1));
folder.load().then(
  ({ name, main, files }) => {
    document.title = `${name} · Zwiebelfisch`;
    createEditor(host, {
      files,
      mainFile: { path: main },
      extensions: (builtinExtensions) => [...builtinExtensions, folderName(name), folder.extension()],
    });
  },
  (error: unknown) => host.append(el('p', { className: 'local-problem', textContent: `The folder cannot be opened: ${error instanceof Error ? error.message : String(error)}` })),
);

/** The folder's name at the title bar's start. */
function folderName(name: string): Extension {
  return {
    id: 'app.folderName',
    activate({ window, subscriptions }) {
      const label = el('span', { textContent: name, title: 'The folder zwiebelfisch opened' });
      subscriptions.push(window.registerTitleBarItem(label, { alignment: 'left', priority: 1000 }));
    },
  };
}
