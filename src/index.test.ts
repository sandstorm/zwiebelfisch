import { describe, expect, it } from 'vitest';

describe('package entry', () => {
  it('can be imported without a DOM (SSR) and exposes both APIs', async () => {
    const api = await import('./index');
    expect(typeof api.createTypstEditor).toBe('function');
    expect(typeof api.defineTypstEditorElement).toBe('function');
    expect(() => api.defineTypstEditorElement()).not.toThrow();
  });
});
