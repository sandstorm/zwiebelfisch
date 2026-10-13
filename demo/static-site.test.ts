// @vitest-environment jsdom
// Tests for static-site.ts.
import { describe, expect, it, vi } from 'vitest';
import type { ExtensionContext } from '../src';
import { READ_ONLY, readOnlyBanner, readOnlySave, STATIC_SITE } from './static-site';

describe('static site', () => {
  it('is only the static build (vite --mode static), not the tests or the playground', () => {
    expect(STATIC_SITE).toBe(false);
  });

  it('the banner says nothing is saved and leads back to the docs, one folder up', () => {
    const banner = readOnlyBanner(document);
    expect(banner.textContent).toContain('nothing is saved');
    expect(banner.textContent).toContain('reloading it starts over');
    expect(banner.querySelector('a')!.getAttribute('href')).toBe('../');
  });

  it('Save (⌘S / Ctrl+S) saves nothing and says so', async () => {
    const extension = readOnlySave();
    expect(extension.contributes?.keybindings).toEqual([{ command: 'workbench.action.files.save', key: 'Mod+KeyS' }]);
    const handlers = new Map<string, () => unknown>();
    const showInformationMessage = vi.fn(async () => undefined);
    const context = {
      commands: { registerCommand: (id: string, run: () => unknown) => (handlers.set(id, run), { dispose() {} }) },
      window: { showInformationMessage },
      subscriptions: [],
    } as unknown as ExtensionContext;
    await extension.activate(context);
    handlers.get('workbench.action.files.save')!();
    expect(showInformationMessage).toHaveBeenCalledWith(READ_ONLY);
  });
});
