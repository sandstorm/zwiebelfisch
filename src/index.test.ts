// Tests for the package exports (index.ts).
import { describe, expect, it } from 'vitest';

// Importing the entry transforms the whole package on first use: seconds, more on a busy machine.
const IMPORT_TIMEOUT = 30_000;

describe('package entry', () => {
  it('can be imported without a DOM (SSR) and exposes both APIs', async () => {
    const api = await import('./index');
    expect(typeof api.createEditor).toBe('function');
    expect(typeof api.defineEditorElement).toBe('function');
    expect(() => api.defineEditorElement()).not.toThrow();
    expect(api.ProjectPath.parse('/chapters/a.typ')).toBe('/chapters/a.typ');
    expect(api.ProgressLocation.EditingArea).toBeDefined();
  }, IMPORT_TIMEOUT);
});
