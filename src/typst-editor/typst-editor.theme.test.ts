// @vitest-environment jsdom
// Tests for typst-editor.ts: the `theme` option (light, dark, auto; default: as the page). Preview mocked: no worker in jsdom.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
    registerPdfVariant = () => ({ dispose() {} });
    destroy() {}
  },
}));

function mount(theme?: 'light' | 'dark' | 'auto') {
  const host = document.body.appendChild(document.createElement('div'));
  return { host, editor: createTypstEditor(host, { source: '= Hello', mode: 'source', theme }) };
}

afterEach(() => document.body.replaceChildren());

describe('the theme option', () => {
  it('marks the widget with the chosen scheme, which its stylesheet turns into a color-scheme', () => {
    const { host } = mount('dark');
    expect(host.dataset.theme).toBe('dark');
    const css = readFileSync('src/typst-editor/typst-editor.css', 'utf8');
    expect(css).toContain(".typst-editor[data-theme='dark'] { color-scheme: dark; }");
  });

  it('leaves the scheme to the page by default', () => {
    expect(mount().host.dataset.theme).toBeUndefined();
  });

  it('is removed with the widget', () => {
    const { host, editor } = mount('auto');
    editor.destroy();
    expect(host.dataset.theme).toBeUndefined();
  });
});
