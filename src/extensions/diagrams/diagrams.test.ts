// @vitest-environment jsdom
// Tests for diagrams.ts in a workbench: the custom editor, auto-save into the project, "New diagram…" (preview
// mocked: no worker in jsdom; the iframe's window faked by its messages).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Disposable } from '../../core/disposable/disposable';
import { ProjectPath } from '../../core/paths/paths';
import { Project } from '../../core/project/project';
import { WorkbenchHost } from '../../hosts/workbench/workbench';
import { diagrams } from './diagrams';
import { emptyDiagram, readDiagramXml, toDataUri, writeDiagramXml } from './model/png';

vi.mock('../../hosts/preview/preview', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Preview: class {
    update() {}
    onDidRender = () => new Disposable(() => {});
    dispose() {}
  },
}));

const path = ProjectPath.of;

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
  sessionStorage.clear();
});

function setup(settings = {}) {
  const host = document.body.appendChild(document.createElement('div'));
  const project = new Project(path('/main.typ'), { '/main.typ': '= Main\n', '/img/flow.drawio.png': emptyDiagram() });
  const workbench = new WorkbenchHost(host, project, { settings });
  workbench.activate([diagrams()]);
  const frame = () => host.querySelector<HTMLIFrameElement>('[data-testid=typst-diagram] iframe');
  const send = (message: object) => window.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message), source: frame()!.contentWindow }));
  return { host, project, workbench, frame, send };
}

describe('diagrams', () => {
  it('opens a .drawio.png in the embedded editor from the setting diagrams.editorUrl', () => {
    const { workbench, frame } = setup({ 'diagrams.editorUrl': 'https://drawio.example.com/app/' });
    workbench.open(path('/img/flow.drawio.png'));
    expect(frame()!.src.startsWith('https://drawio.example.com/app/?embed=1&proto=json')).toBe(true);
    workbench.open(path('/main.typ'));
    expect(frame()).toBeNull();
  });

  it('saves the exported PNG into the project as an update, and what is pending when the file is closed', async () => {
    const { workbench, project, send } = setup();
    const changes: string[] = [];
    project.onDidChangeFile((change) => changes.push(`${change.kind} ${change.path}`));
    workbench.open(path('/img/flow.drawio.png'));
    send({ event: 'init' });
    send({ event: 'autosave', xml: '<mxfile>a</mxfile>' });
    send({ event: 'export', format: 'xmlpng', xml: '<mxfile>a</mxfile>', data: toDataUri(writeDiagramXml(emptyDiagram(), '<mxfile>a</mxfile>')) });
    workbench.open(path('/main.typ'));
    await vi.waitFor(() => expect(changes).toEqual(['update /img/flow.drawio.png']));
    expect(readDiagramXml(project.content(path('/img/flow.drawio.png')) as Uint8Array)).toBe('<mxfile>a</mxfile>');
  });

  it('"New diagram…" in the file panel\'s "New" asks for a name in the row\'s folder, creates an empty diagram and opens it', async () => {
    const { host, workbench, project, frame } = setup();
    expect(workbench.getMenuItems('file/newFile').map((item) => [item.command, item.title])).toEqual([['diagrams.newDiagram', 'New diagram…']]);
    const done = workbench.commands.executeCommand('diagrams.newDiagram', path('/img/flow.drawio.png'));
    const form = host.querySelector<HTMLFormElement>('form[aria-label="New diagram"]')!;
    const input = form.querySelector('input')!;
    expect(input.value).toBe('img/');
    input.value = 'img/flow';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => expect(form.querySelector('[role=alert]')!.textContent).toBe('img/flow.drawio.png already exists.'));
    input.value = 'img/Architecture.drawio';
    form.requestSubmit();
    await done;
    const created = project.content(path('/img/Architecture.drawio.png'));
    expect(readDiagramXml(created as Uint8Array)).toBe(readDiagramXml(emptyDiagram()));
    expect(workbench.window.activeFile).toBe('/img/Architecture.drawio.png');
    expect(frame()).not.toBeNull();
  });
});
