import { createTypstEditor } from '../src';
import { EXAMPLES, exampleFiles, exampleFromQuery, exampleQuery, type ExampleName } from './examples';

const params = new URLSearchParams(location.search);
// `?example=hello|simple|advanced` picks the project (`?files` is the older name for `advanced`).
const example = exampleFromQuery(params);
// `?room=<name>` edits together with everyone in that room, through the local
// collaboration server (`mise run server:dev`); `&user=<name>` sets the name others see.
const room = params.get('room');
const user = { name: params.get('user') ?? (room ? `Guest ${Math.floor(Math.random() * 1000)}` : 'Demo user') };

renderSwitcher(document.getElementById('examples')!, example);

const editor = createTypstEditor(document.getElementById('editor')!, {
  files: exampleFiles(example),
  user,
  collaboration: room ? { url: 'ws://127.0.0.1:1234', room } : undefined,
});
Object.assign(window, { editor });

/** One link per example; switching reloads the page with the other example. */
function renderSwitcher(nav: HTMLElement, current: ExampleName): void {
  for (const { name, label } of EXAMPLES) {
    const link = document.createElement('a');
    link.textContent = label;
    link.href = exampleQuery(name, params);
    if (name === current) link.setAttribute('aria-current', 'page');
    nav.append(link);
  }
}
