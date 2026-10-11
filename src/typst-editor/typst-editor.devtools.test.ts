// @vitest-environment jsdom
// Tests for the devtools extension (extensions/devtools/devtools.ts) in the widget, every built-in extension
// instrumented (preview mocked: no worker in jsdom).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { devtools } from '../extensions/devtools/devtools';
import { createTypstEditor } from './typst-editor';

vi.mock('../hosts/preview/preview', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Preview: class {
    update() {}
    reveal() {}
    snippet = async () => null;
    onDidRender = () => ({ dispose() {} });
    onDidClickPage = () => ({ dispose() {} });
    onDidChangeDiagnostics = () => ({ dispose() {} });
    registerToolbarItem = () => ({ dispose() {} });
    registerPdfExportOption = () => ({ dispose() {} });
    pdfExportOptions = () => [];
    dispose() {}
  },
}));

function mount() {
  const host = document.body.appendChild(document.createElement('div'));
  const editor = createTypstEditor(host, { source: '= Hello\n\n#foo()', extensions: (builtins) => devtools(builtins) });
  const panel = host.querySelector<HTMLElement>('[data-testid=typst-devtools]')!;
  const tab = (name: string) => {
    [...panel.querySelectorAll<HTMLButtonElement>('[role=tab]')].find((button) => button.textContent === name)!.click();
    return panel.querySelector<HTMLElement>('[role=tabpanel]')!;
  };
  return { host, editor, tab };
}

afterEach(() => document.body.replaceChildren());

describe('devtools', () => {
  it('leaves the widget working: the built-ins activate through the recording context', () => {
    const { host } = mount();
    expect(host.querySelector('[data-testid=typst-visual] h1')?.textContent).toBe('Hello');
  });

  it('is a panel on the right rail, after the preview, shown on a click instead of the preview', () => {
    const { host } = mount();
    const right = host.querySelector<HTMLElement>('.typst-editor__side--right')!;
    expect([...right.querySelectorAll<HTMLElement>('.typst-editor__rail-button')].map((button) => button.title)).toEqual(['Preview', 'Devtools']);
    expect(right.querySelector<HTMLElement>('[data-panel=devtools]')!.hidden).toBe(true);
    right.querySelector<HTMLElement>('[data-testid=typst-panel-toggle-devtools]')!.click();
    expect(right.querySelector<HTMLElement>('[data-panel=devtools]')!.hidden).toBe(false);
    expect(right.querySelector<HTMLElement>('[data-panel=preview]')!.hidden).toBe(true);
  });

  it('lists the contributions by extension in their points\' terms, settings included, each with its details as tooltip', () => {
    const contributions = mount().tab('Contributions');
    const text = contributions.textContent;
    for (const expected of ['files', 'contributes.configuration', 'files.panel', 'default "auto"', 'commands.registerCommand', 'files.newFile', 'visualEditor.registerNode', 'heading', 'parses Heading', 'Mod+Alt+KeyM → comments.addComment', 'devtools', 'workbench.registerSidePanel']) {
      expect(text).toContain(expected);
    }
    const heading = [...contributions.querySelectorAll<HTMLElement>('.typst-devtools__contribution')].find((row) => row.textContent?.startsWith('visualEditor.registerNodeheading'))!;
    expect(heading.title).toMatch(/^visualEditor\.registerNode: heading\nby headings, registered at .+\n\n\[/);
  });

  it('groups the contributions by point: the competing ones in the order the host resolves them', () => {
    const contributions = mount().tab('Contributions');
    [...contributions.querySelectorAll('button')].find((button) => button.textContent === 'By contribution point')!.click();
    const renderers = [...contributions.querySelectorAll('details')].find((group) => group.querySelector('summary')?.textContent?.startsWith('visualEditor.registerRawBoxRenderer'))!;
    const rows = [...renderers.querySelectorAll('.typst-devtools__contribution')].map((row) => row.textContent);
    // the image renderer (110) before the compiled snippets (100)
    expect(rows).toEqual([expect.stringMatching(/^images.*priority 110$/), expect.stringMatching(/^rendered-boxes.*priority 100$/)]);
  });

  it("shows the shown file's document: each node with its source range, boxes marked", async () => {
    const { tab } = mount();
    // Tiptap tells an editor's extensions it was created after a timeout
    await new Promise((resolve) => setTimeout(resolve));
    const document = tab('Document');
    const rows = [...document.querySelectorAll('.typst-devtools__node')].map((row) => row.textContent);
    expect(rows[0]).toMatch(/^heading0–7/);
    expect(rows).toContainEqual(expect.stringMatching(/^rawBlock9–15box"#foo\(\)"/));
  });

  it('logs the events as they fire, their values in full; filters them by name', () => {
    const { editor, tab } = mount();
    editor.source = '= Changed';
    const events = tab('Events');
    expect(events.textContent).toContain('project.onDidChangeFile');
    const change = [...events.querySelectorAll<HTMLElement>('.typst-devtools__event')].find((row) => row.textContent?.includes('project.onDidChangeFile'))!;
    expect(change.textContent).toContain('kind: "update"');
    expect(change.title).toContain('content: "= Changed"');

    const filter = events.querySelector<HTMLInputElement>('input[type=search]')!;
    filter.value = 'selection';
    filter.dispatchEvent(new Event('input'));
    expect(events.textContent).not.toContain('project.onDidChangeFile');
  });
});
