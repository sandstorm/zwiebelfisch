// Tests for the package exports (index.ts).
import { describe, expect, it } from 'vitest';

// Importing the entry transforms the whole package on first use: seconds, more on a busy machine.
const IMPORT_TIMEOUT = 30_000;

describe('package entry', () => {
  it('can be imported without a DOM (SSR) and exposes both APIs', async () => {
    const api = await import('./index');
    expect(typeof api.createTypstEditor).toBe('function');
    expect(typeof api.defineTypstEditorElement).toBe('function');
    expect(() => api.defineTypstEditorElement()).not.toThrow();
  }, IMPORT_TIMEOUT);
});
