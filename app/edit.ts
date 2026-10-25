// The editor page (/edit?room=gitlab:<project>@<branch>[:/<folder>]): the widget in that room of this origin's server.
// Signed out, the collaboration extension's card signs in; the title bar leads back to the start page. A guest link
// (#zwf-guest=…) opens here too.

import { collaboration, createEditor, type Extension } from '../src';

const room = new URLSearchParams(location.search).get('room');
if (!room) location.replace('/');
else {
  document.title = `${room.replace(/^gitlab:/, '')} · Zwiebelfisch`;
  createEditor(document.getElementById('editor')!, {
    // a GitLab room is loaded from the repository
    files: {},
    extensions: (builtinExtensions) => [
      ...builtinExtensions,
      backToProjects(),
      collaboration({ url: location.origin.replace(/^http/, 'ws'), room }),
    ],
  });
}

/** "← Projects" at the title bar's start: the start page. */
function backToProjects(): Extension {
  return {
    id: 'app.projects',
    activate({ window, subscriptions }) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = '← Projects';
      button.title = 'All projects';
      button.addEventListener('click', () => location.assign('/'));
      subscriptions.push(window.registerTitleBarItem(button, { alignment: 'left', priority: 1000 }));
    },
  };
}
