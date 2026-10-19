// @vitest-environment jsdom
// Tests for the devtools extension (extensions/devtools/devtools.ts) in the widget, every extension instrumented
// (preview mocked: no worker in jsdom; `engine.compiled(bytes)` tells the engine's memory after a compile).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEditor, type EditorOptions } from './editor';

const engine = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  return {
    memory: 0,
    listeners,
    compiled(bytes: number) {
      this.memory = bytes;
      listeners.forEach((listener) => listener());
    },
  };
});

vi.mock('../hosts/preview/preview', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Preview: class {
    get engineMemory() {
      return engine.memory;
    }
    onDidChangeEngineMemory(listener: () => void) {
      engine.listeners.add(listener);
      return { dispose: () => engine.listeners.delete(listener) };
    }
    update() {}
    reveal() {}
    snippet = async () => null;
    onDidRender = () => ({ dispose() {} });
    onDidClickPage = () => ({ dispose() {} });
    createPageOverlay = () => ({ set() {}, dispose() {} });
    boxesFor = async () => [];
    onDidChangeDiagnostics = () => ({ dispose() {} });
    registerToolbarItem = () => ({ dispose() {} });
    registerPdfExportOption = () => ({ dispose() {} });
    pdfExportOptions = () => [];
    registerViewOption = () => ({ dispose() {} });
    viewOptions = () => [];
    onDidChangeViewOptions = () => ({ dispose() {} });
    setViewOptionValues() {}
    registerRenderer = () => ({ dispose() {} });
    renderers = () => [{ id: 'pages', label: 'Pages' }];
    activeRenderer = 'pages';
    setActiveRenderer() {}
    onDidChangeRenderers = () => ({ dispose() {} });
    dispose() {}
  },
}));

function mount(options: Partial<EditorOptions> = {}) {
  const host = document.body.appendChild(document.createElement('div'));
  const editor = createEditor(host, { source: '= Hello\n\n#foo()', ...options });
  const panel = host.querySelector<HTMLElement>('[data-testid=zwf-devtools]')!;
  const toggle = host.querySelector<HTMLElement>('[data-testid=zwf-panel-toggle-devtools]')!;
  /** Shows the devtools panel (instead of the preview), or the preview again. */
  const show = (shown = true) => {
    if ((toggle.getAttribute('aria-pressed') === 'true') !== shown) toggle.click();
  };
  const tab = (name: string) => {
    show();
    [...panel.querySelectorAll<HTMLButtonElement>('[role=tab]')].find((button) => button.textContent === name)!.click();
    return panel.querySelector<HTMLElement>('[role=tabpanel]')!;
  };
  const memory = () => panel.querySelector<HTMLDetailsElement>('[data-testid=zwf-devtools-memory]')!;
  return { host, editor, tab, show, memory };
}

/** The panel redraws once per frame. */
const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

afterEach(() => {
  document.body.replaceChildren();
  // the panel picked is remembered for the session
  sessionStorage.clear();
  engine.memory = 0;
  engine.listeners.clear();
});

describe('devtools', () => {
  it('leaves the widget working: the built-ins activate through the recording context', () => {
    const { host } = mount();
    expect(host.querySelector('[data-testid=zwf-visual] h1')?.textContent).toBe('Hello');
  });

  it('is a panel on the right rail, after the preview, shown on a click instead of the preview', () => {
    const { host } = mount();
    const right = host.querySelector<HTMLElement>('.zwf-editor__side--right')!;
    expect([...right.querySelectorAll<HTMLElement>('.zwf-editor__rail-button')].map((button) => button.title)).toEqual(['Preview', 'Devtools']);
    expect(right.querySelector<HTMLElement>('[data-panel=devtools]')!.hidden).toBe(true);
    right.querySelector<HTMLElement>('[data-testid=zwf-panel-toggle-devtools]')!.click();
    expect(right.querySelector<HTMLElement>('[data-panel=devtools]')!.hidden).toBe(false);
    expect(right.querySelector<HTMLElement>('[data-panel=preview]')!.hidden).toBe(true);
  });

  it('is switched off and on with the setting devtools.enabled, showing the memory recorded meanwhile', () => {
    const { host, editor, memory } = mount({ settings: { 'devtools.enabled': false } });
    const toggle = host.querySelector<HTMLElement>('[data-testid=zwf-panel-toggle-devtools]')!;
    expect(toggle.hidden).toBe(true);
    engine.compiled(300 * 2 ** 20);
    editor.updateSettings({ 'devtools.enabled': undefined });
    expect(toggle.hidden).toBe(false);
    toggle.click();
    expect(memory().querySelector('summary')!.textContent).toBe('Typst engine memory: 300 MB of 4 GB (7%)');
  });

  it("shows the engine's memory after each compile that changed it: how it grew, and the peak after a new engine", () => {
    const { show, memory } = mount();
    show();
    expect(memory().textContent).toBe('Typst engine memory: nothing compiled yet');
    engine.compiled(200 * 2 ** 20);
    engine.compiled(780 * 2 ** 20);
    expect(memory().querySelector('summary')!.textContent).toBe('Typst engine memory: 780 MB of 4 GB (19%)');
    // the engine crashed; the new one starts small
    engine.compiled(50 * 2 ** 20);
    expect(memory().querySelector('summary')!.textContent).toBe('Typst engine memory: 50 MB of 4 GB (1%), peak 780 MB');
    const changes = [...memory().querySelectorAll('li')].map((row) => row.textContent!.replace(/^[\d:]{8}/, ''));
    expect(changes).toEqual(['50 MB−730 MB', '780 MB+580 MB', '200 MB+200 MB']);
  });

  it("records the host's extensions too", () => {
    const contributions = mount({
      extensions: (builtins) => [...builtins, { id: 'mine', activate: ({ commands, subscriptions }) => subscriptions.push(commands.registerCommand('mine.run', () => {})) }],
    }).tab('Contributions');
    expect(contributions.textContent).toContain('mine.run');
  });

  it('lists the contributions by extension in their points\' terms, settings included, each with its details as tooltip', () => {
    const contributions = mount().tab('Contributions');
    const text = contributions.textContent;
    for (const expected of ['files', 'contributes.configuration', 'files.panel', 'default "auto"', 'commands.registerCommand', 'files.newFile', 'visualEditor.registerNode', 'heading', 'parses Heading', 'Mod+Alt+KeyM → comments.addComment', 'devtools', 'workbench.registerSidePanel']) {
      expect(text).toContain(expected);
    }
    const heading = [...contributions.querySelectorAll<HTMLElement>('.zwf-devtools__contribution')].find((row) => row.textContent?.startsWith('visualEditor.registerNodeheading'))!;
    expect(heading.title).toMatch(/^visualEditor\.registerNode: heading\nby headings, registered at .+\n\n\[/);
  });

  it('groups the contributions by point: the competing ones in the order the host resolves them', () => {
    const contributions = mount().tab('Contributions');
    [...contributions.querySelectorAll('button')].find((button) => button.textContent === 'By contribution point')!.click();
    const renderers = [...contributions.querySelectorAll('details')].find((group) => group.querySelector('summary')?.textContent?.startsWith('visualEditor.registerRawBoxRenderer'))!;
    const rows = [...renderers.querySelectorAll('.zwf-devtools__contribution')].map((row) => row.textContent);
    // the image renderer (110) before the compiled snippets (100)
    expect(rows).toEqual([expect.stringMatching(/^images.*priority 110$/), expect.stringMatching(/^rendered-boxes.*priority 100$/)]);
  });

  it("shows the shown file's document: each node with its source range, boxes marked", async () => {
    const { tab } = mount();
    // Tiptap tells an editor's extensions it was created after a timeout
    await new Promise((resolve) => setTimeout(resolve));
    const document = tab('Document');
    const rows = [...document.querySelectorAll('.zwf-devtools__node')].map((row) => row.textContent);
    expect(rows[0]).toMatch(/^heading0–7/);
    expect(rows).toContainEqual(expect.stringMatching(/^rawBlock9–15box"#foo\(\)"/));
  });

  it('logs the events only while the panel is shown, all of them', async () => {
    const { editor, tab, show } = mount();
    editor.source = '= While hidden';
    const events = tab('Events');
    expect(events.textContent).not.toContain('While hidden');
    for (let i = 0; i < 400; i++) editor.source = `= Shown ${i}`;
    await frame();
    expect(events.querySelectorAll('.zwf-devtools__event').length).toBeGreaterThan(400);
    expect(events.textContent).toContain('content: "= Shown 0"');
    show(false);
    editor.source = '= Hidden again';
    show();
    expect(events.textContent).toContain('content: "= Shown 399"');
    expect(events.textContent).not.toContain('Hidden again');
  });

  it('logs the events as they fire, their values in full; filters them by name', async () => {
    const { editor, tab } = mount();
    const events = tab('Events');
    editor.source = '= Changed';
    await frame();
    expect(events.textContent).toContain('project.onDidChangeFile');
    const change = [...events.querySelectorAll<HTMLElement>('.zwf-devtools__event')].find((row) => row.textContent?.includes('project.onDidChangeFile'))!;
    expect(change.textContent).toContain('kind: "update"');
    expect(change.title).toContain('content: "= Changed"');

    const filter = events.querySelector<HTMLInputElement>('input[type=search]')!;
    filter.value = 'selection';
    filter.dispatchEvent(new Event('input'));
    expect(events.textContent).not.toContain('project.onDidChangeFile');
  });
});
