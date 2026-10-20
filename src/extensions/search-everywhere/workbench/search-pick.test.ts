// @vitest-environment jsdom
// Tests for search-pick.ts (SearchPick) over a window: groups, matching, prefixes, async providers and picking.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CancellationToken } from '../../../core/cancellation/cancellation';
import { ProjectPath } from '../../../core/paths/paths';
import { Project } from '../../../core/project/project';
import { CommandsHost } from '../../../hosts/commands/commands';
import { SourceEditorHost } from '../../../hosts/source-editor/source-editor';
import { VisualEditorHost } from '../../../hosts/visual-editor/visual-editor';
import { type SearchItem, type SearchProvider, WindowHost } from '../../../hosts/window/window';
import { WorkspaceHost } from '../../../hosts/workspace/workspace';
import { SearchPick } from './search-pick';

afterEach(() => document.body.replaceChildren());

function setup(...providers: SearchProvider[]) {
  const host = document.body.appendChild(document.createElement('div'));
  const project = new Project(ProjectPath.of('/main.typ'), { '/main.typ': '' });
  const window = new WindowHost({
    host,
    project,
    commands: new CommandsHost(host),
    workspace: new WorkspaceHost(project),
    visualEditor: new VisualEditorHost(),
    sourceEditor: new SourceEditorHost(),
    layoutState: { get: () => undefined, update: async () => {} },
  });
  const search = new SearchPick(window);
  for (const provider of providers) window.registerSearchProvider(provider);
  const field = () => host.querySelector<HTMLInputElement>('.zwf-quick-pick input')!;
  const type = (value: string) => {
    field().value = value;
    field().dispatchEvent(new Event('input'));
  };
  /** The rows shown: `# Heading` for a group's heading, else the item's text. */
  const rows = () =>
    [...host.querySelectorAll<HTMLElement>('.zwf-quick-pick__heading, [role=option]')].map((row) =>
      row.getAttribute('role') === 'option' ? row.textContent : `# ${row.textContent}`,
    );
  const marked = () => [...host.querySelectorAll('mark')].map((mark) => mark.textContent);
  return { host, window, search, field, type, rows, marked };
}

function items(...labels: string[]): SearchItem[] {
  return labels.map((label) => ({ label, accept: vi.fn() }));
}

function provider(id: string, labels: string[], more: Partial<SearchProvider> = {}): SearchProvider {
  return { id, label: id, provideItems: () => items(...labels), ...more };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('SearchEverywhere', () => {
  it('shows every provider as a group in `order`, matching fuzzily and marking the matches', () => {
    const { search, type, rows, marked } = setup(
      provider('Headings', ['Introduction', 'Method', 'Results'], { order: 20 }),
      provider('Files', ['intro.typ', 'main.typ'], { order: 10 }),
    );
    search.show();
    expect(rows()).toEqual(['# Files', 'intro.typ', 'main.typ', '# Headings', 'Introduction', 'Method', 'Results']);
    type('intr');
    expect(rows()).toEqual(['# Files', 'intro.typ', '# Headings', 'Introduction']);
    expect(marked()).toEqual(['intr', 'Intr']);
    type('nothing like it');
    expect(rows()).toEqual([]);
    expect(document.querySelector<HTMLElement>('.zwf-quick-pick__empty')!.hidden).toBe(false);
  });

  it('matches the description when the label does not match, ranked below label matches', () => {
    const { search, type, rows } = setup({
      id: 'files',
      label: 'Files',
      provideItems: () => [
        { label: 'intro.typ', description: '/chapters/intro.typ', accept() {} },
        { label: 'chapter-notes.typ', description: '/chapter-notes.typ', accept() {} },
      ],
    });
    search.show();
    type('chapter');
    expect(rows()).toEqual(['# Files', 'chapter-notes.typ /chapter-notes.typ', 'intro.typ /chapters/intro.typ']);
  });

  it('narrows to the providers of a prefix, which show more, and says how in the hint and the headings', () => {
    const labels = Array.from({ length: 8 }, (_, i) => `Heading ${i + 1}`);
    const { host, search, type, rows } = setup(provider('Headings', labels, { prefix: '#', order: 10 }), provider('Files', ['heading.typ']));
    search.show();
    expect(host.querySelector('.zwf-quick-pick__hint')!.textContent).toBe('Narrow with # Headings');
    expect(rows()[0]).toBe('# Headings 3 more · type #');
    expect(rows()).toHaveLength(5 + 1 + 2);
    type('#head');
    expect(rows()).toEqual(['# Headings', ...labels]);
    type('# 8');
    expect(rows()).toEqual(['# Headings', 'Heading 8']);
  });

  it('narrows a prefix to every provider sharing it, and names it once in the hint', () => {
    const { host, search, type, rows } = setup(provider('Text', ['a quick fox'], { prefix: '%', order: 90 }), provider('More', ['quick, everywhere'], { prefix: '%', order: 91 }));
    search.show();
    expect(host.querySelector('.zwf-quick-pick__hint')!.textContent).toBe('Narrow with % Text');
    type('%quick');
    expect(rows()).toEqual(['# Text', 'a quick fox', '# More', 'quick, everywhere']);
  });

  it('opens with a value, e.g. a prefix', () => {
    const { search, field, rows } = setup(provider('Commands', ['Add comment'], { prefix: '>' }), provider('Files', ['a.typ']));
    search.show('>');
    expect(field().value).toBe('>');
    expect(rows()).toEqual(['# Commands', 'Add comment']);
  });

  it('shows items a provider matched itself as given, in its order, after its async answer, cancelling earlier rounds', async () => {
    const tokens: CancellationToken[] = [];
    const text: SearchProvider = {
      id: 'text',
      label: 'Text',
      provideItems: async (query, token) => {
        tokens.push(token);
        await tick();
        return query ? [{ label: `zz ${query} zz`, highlights: { label: [[3, 3 + query.length]] }, accept() {} }] : [];
      },
    };
    const { host, search, type, rows, marked } = setup(text, provider('Files', ['a.typ']));
    search.show();
    type('needle');
    const progress = host.querySelector<HTMLElement>('.zwf-quick-pick__progress')!;
    expect(progress.hidden).toBe(false);
    expect(tokens.map((token) => token.isCancellationRequested)).toEqual([true, false]);
    await tick();
    expect(rows()).toEqual(['# Text', 'zz needle zz']);
    expect(marked()).toEqual(['needle']);
    expect(progress.hidden).toBe(true);
    search.dispose();
    expect(tokens[1].isCancellationRequested).toBe(true);
  });

  it('runs the picked item once the search is closed and the focus is back', () => {
    const { host, window, search, field, rows } = setup(provider('Files', ['a.typ', 'b.typ']));
    const button = host.appendChild(document.createElement('button'));
    button.focus();
    const picked = vi.fn(() => expect([document.activeElement, host.querySelector('.zwf-quick-pick')]).toEqual([button, null]));
    window.registerSearchProvider({ id: 'more', label: 'More', provideItems: () => [{ label: 'b.typ again', accept: picked }] });
    search.show();
    expect(rows()).toContain('b.typ again');
    search.show('again');
    field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(picked).toHaveBeenCalledTimes(1);
  });

  it('logs a failing provider and shows the others', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing: SearchProvider = {
      id: 'failing',
      label: 'Failing',
      provideItems: () => {
        throw new Error('broken');
      },
    };
    const { search, rows } = setup(failing, provider('Files', ['a.typ']));
    search.show();
    expect(rows()).toEqual(['# Files', 'a.typ']);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('refuses a second provider with the same id', () => {
    const { window } = setup(provider('Files', []));
    expect(() => window.registerSearchProvider(provider('Files', []))).toThrow();
  });
});
