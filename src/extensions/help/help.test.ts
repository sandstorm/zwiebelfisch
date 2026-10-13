// @vitest-environment jsdom
// Tests for help.ts in a workbench, with sheets of the test's own (preview mocked: no worker in jsdom): the sheet of the
// shown file's language, switching with the file; inserting a row with Enter into the Source and the Visual editor; the
// drag data of a row; its context menu.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Disposable } from '../../core/disposable/disposable';
import { ProjectPath } from '../../core/paths/paths';
import { Project } from '../../core/project/project';
import { SourceRange } from '../../core/typst-document/typst-document';
import type { HelpSheet } from '../../hosts/languages/languages';
import { SOURCE_EDITOR } from '../../hosts/source-editor/source-editor';
import type { WindowApi } from '../../hosts/window/window';
import { type Extension, WorkbenchHost } from '../../hosts/workbench/workbench';
import { help } from './help';

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
  document.body.replaceChildren();
  sessionStorage.clear();
});

const TYPST: HelpSheet = {
  title: 'Typst basics',
  sections: [
    { title: 'Emphasis', rows: [{ snippet: '*strong*', description: 'Bold' }, { snippet: 'plain', description: 'Text' }] },
    { title: 'Headings', rows: [{ snippet: '= Heading', description: 'A heading', insert: '= Heading\n' }] },
  ],
  links: [
    { label: 'Typst documentation', href: 'https://typst.app/docs' },
    { label: 'Not shown', href: 'javascript:alert(1)' },
  ],
};
const MERMAID: HelpSheet = { title: 'Mermaid basics', sections: [{ title: 'Flowchart', rows: [{ snippet: 'A --> B', description: 'An arrow' }] }] };

/** Sheets for `typst` and `mermaid` (`.mmd` declared here), as the languages' extensions register them. */
const sheets: Extension = {
  id: 'sheets',
  contributes: { languages: [{ id: 'mermaid', extensions: ['.mmd'] }] },
  activate: ({ languages, subscriptions }) =>
    subscriptions.push(
      languages.registerHelpProvider({ language: 'typst' }, { provideHelp: () => TYPST }),
      languages.registerHelpProvider({ language: 'mermaid' }, { provideHelp: () => MERMAID }),
    ),
};

function setup(viewType?: string) {
  const host = document.body.appendChild(document.createElement('div'));
  const project = new Project(path('/main.typ'), { '/main.typ': 'Hello world\n', '/flow.mmd': 'flowchart LR\n', '/logo.png': new Uint8Array() });
  const workbench = new WorkbenchHost(host, project, { viewType });
  let window!: WindowApi;
  workbench.activate([help(), sheets, { id: 'probe', activate: (context) => void (window = context.window) }]);
  const panel = host.querySelector<HTMLElement>('[data-testid=typst-help]')!;
  const row = (snippet: string) => [...panel.querySelectorAll<HTMLElement>('[role=option]')].find((option) => option.querySelector('code')?.textContent === snippet)!;
  const press = (target: HTMLElement, key: string, init: KeyboardEventInit = {}) => target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  return { host, project, workbench, window, panel, row, press, text: () => project.document(path('/main.typ'))!.text };
}

describe('help', () => {
  it('is a left side panel "Help" next to Files, with the sheet of the shown file: a list per section, its links', () => {
    const { host, panel } = setup();
    expect(host.querySelector('[data-testid=typst-panel-toggle-help]')?.getAttribute('aria-label')).toBe('Help');
    expect(panel.querySelector('h2')?.textContent).toBe('Typst basics');
    const lists = [...panel.querySelectorAll('[role=listbox]')];
    expect(lists.map((list) => panel.querySelector(`#${list.getAttribute('aria-labelledby')}`)?.textContent)).toEqual(['Emphasis', 'Headings']);
    expect([...lists[0].querySelectorAll('[role=option]')].map((option) => option.textContent)).toEqual(['*strong*Bold', 'plainText']);
    expect([...panel.querySelectorAll('a')].map((link) => [link.textContent, link.href, link.target])).toEqual([['Typst documentation', 'https://typst.app/docs', '_blank']]);
  });

  it('switches the sheet with the shown file; a file without one says so', () => {
    const { workbench, panel } = setup();
    workbench.open(path('/flow.mmd'));
    expect(panel.querySelector('h2')?.textContent).toBe('Mermaid basics');
    workbench.open(path('/logo.png'));
    expect(panel.querySelector('h2')).toBeNull();
    expect(panel.textContent).toBe('No help for this file type.');
    workbench.open(path('/main.typ'));
    expect(panel.querySelector('h2')?.textContent).toBe('Typst basics');
  });

  it('a click selects a row (one tab stop, the focus on it); arrows move the selection', () => {
    const { row, press } = setup();
    expect(row('*strong*').tabIndex).toBe(0);
    row('= Heading').click();
    expect(row('= Heading').getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(row('= Heading'));
    expect([row('*strong*').tabIndex, row('= Heading').tabIndex]).toEqual([-1, 0]);
    press(row('= Heading'), 'Home');
    expect(document.activeElement).toBe(row('*strong*'));
    press(row('*strong*'), 'End');
    press(row('= Heading'), 'ArrowUp');
    expect(row('plain').getAttribute('aria-selected')).toBe('true');
    expect(row('= Heading').getAttribute('aria-selected')).toBe('false');
  });

  it('Enter inserts the row at the cursor of the Source editor', () => {
    const { window, row, press, text } = setup(SOURCE_EDITOR);
    window.activeTextEditor!.revealRange(SourceRange.of({ from: 6, to: 6 }));
    press(row('*strong*'), 'Enter');
    expect(text()).toBe('Hello *strong*world\n');
    expect(window.activeTextEditor!.selection).toEqual({ from: 14, to: 14 });
  });

  it('Enter inserts the row in the Visual editor, read as Typst: inline into the text, blocks after the paragraph', () => {
    const { window, row, press, text } = setup();
    window.activeTextEditor!.revealRange(SourceRange.of({ from: 5, to: 5 }));
    press(row('plain'), 'Enter');
    expect(text()).toBe('Helloplain world\n');
    press(row('= Heading'), 'Enter');
    expect(text()).toBe('Helloplain world\n\n= Heading\n');
  });

  it('a dragged row carries what it inserts: as text, and for a Typst sheet as Typst for the Visual editor', () => {
    const { workbench, row } = setup();
    const drag = (option: HTMLElement) => {
      const data = new Map<string, string>();
      const event = Object.assign(new Event('dragstart', { bubbles: true }), { dataTransfer: { setData: (type: string, value: string) => data.set(type, value), effectAllowed: 'all' } });
      option.dispatchEvent(event);
      return Object.fromEntries(data);
    };
    expect(row('= Heading').draggable).toBe(true);
    expect(drag(row('= Heading'))).toEqual({ 'text/plain': '= Heading\n', 'application/x-typst-snippet': '= Heading\n' });
    workbench.open(path('/flow.mmd'));
    expect(drag(row('A --> B'))).toEqual({ 'text/plain': 'A --> B' });
  });

  it('the context menu offers "Insert at cursor" (while a Typst editor is shown) and "Copy"', () => {
    const { host, workbench, row, press } = setup();
    const menu = () => [...host.querySelectorAll('[role=menuitem]')].map((item) => item.textContent);
    row('*strong*').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 6 }));
    expect(menu()).toEqual(['Insert at cursor', 'Copy']);
    workbench.open(path('/flow.mmd'));
    press(row('A --> B'), 'F10', { shiftKey: true });
    expect(menu()).toEqual(['Copy']);
  });

  it('Enter with no Typst editor shown copies the row instead, and says so', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { host, workbench, row, press } = setup();
    workbench.open(path('/flow.mmd'));
    press(row('A --> B'), 'Enter');
    expect(writeText).toHaveBeenCalledWith('A --> B');
    await vi.waitFor(() => expect(host.querySelector('[data-testid=typst-notifications]')?.textContent).toContain('Copied'));
  });
});
