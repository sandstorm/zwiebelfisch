// @vitest-environment jsdom
// Tests for devtools.ts: the panel in a widget with every built-in extension instrumented (preview mocked: no worker
// in jsdom).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTypstEditor } from '../../src';
import { devtools } from './devtools';

vi.mock('../../src/hosts/preview/preview', async (importOriginal) => ({
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

  it('lists the contributions by extension, settings included', () => {
    const text = mount().tab('Contributions').textContent;
    for (const expected of ['files', 'contributes.configuration', 'files.panel', 'commands.registerCommand', 'files.newFile', 'visualView.registerNode', 'heading', 'devtools', 'workbench.registerSidePanel']) {
      expect(text).toContain(expected);
    }
  });

  it("shows the shown file's projection: each node with its source range, boxes marked", async () => {
    const { tab } = mount();
    // Tiptap tells a view's extensions it was created after a timeout
    await new Promise((resolve) => setTimeout(resolve));
    const projection = tab('Projection');
    const rows = [...projection.querySelectorAll('.typst-devtools__node')].map((row) => row.textContent);
    expect(rows[0]).toMatch(/^heading0–7/);
    expect(rows).toContainEqual(expect.stringMatching(/^rawBlock9–15box"#foo\(\)"/));
  });

  it('logs the events as they fire', () => {
    const { editor, tab } = mount();
    editor.source = '= Changed';
    expect(tab('Events').textContent).toContain('project.onDidChangeFile');
  });
});
