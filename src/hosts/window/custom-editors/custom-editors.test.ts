// @vitest-environment jsdom
// Tests for custom-editors.ts and filename-pattern.ts.
import { describe, expect, it, vi } from 'vitest';
import { ProjectPath } from '../../../core/paths/paths';
import type { CustomDocument, CustomEditorPanel, CustomEditorProvider } from '../window';
import { CustomEditors } from './custom-editors';
import { FilenamePattern } from './filename-pattern';

const path = ProjectPath.of;

function provider() {
  const opened: { document: CustomDocument; panel: CustomEditorPanel; disposed: boolean }[] = [];
  const created: CustomEditorProvider = {
    resolveCustomEditor: vi.fn((document, panel) => {
      const entry = { document, panel, disposed: false };
      panel.onDidDispose(() => {
        // the element is still in place while the editor stores what is pending
        expect(panel.element.parentElement).not.toBeNull();
        entry.disposed = true;
      });
      opened.push(entry);
    }),
  };
  return { opened, provider: created };
}

/** The editors the images, spreadsheets and diagrams extensions register. */
function builtins(parent: HTMLElement) {
  const editors = new CustomEditors(parent);
  const images = provider();
  const files = provider();
  const sheets = provider();
  const diagrams = provider();
  editors.register('images.preview', images.provider, { filenamePattern: '*.{png,jpg,jpeg,gif,svg,webp}' });
  editors.register('images.file', files.provider, { filenamePattern: '*' });
  editors.register('spreadsheets.editor', sheets.provider, { filenamePattern: '*.ic' });
  editors.register('diagrams.editor', diagrams.provider, { filenamePattern: '*.drawio.png', priority: 110 });
  return { editors, images, files, sheets, diagrams };
}

const show = (editors: CustomEditors, at: string, viewType?: string) => editors.show({ path: path(at), content: new Uint8Array([1]) }, viewType);

describe('FilenamePattern', () => {
  it('matches the file name (or the path with a /), case-insensitively, with * ** ? and {a,b}', () => {
    expect(new FilenamePattern('*.drawio.png').matches(path('/img/a.drawio.png'))).toBe(true);
    expect(new FilenamePattern('*.drawio.png').matches(path('/a.png'))).toBe(false);
    expect(new FilenamePattern('*.{png,jpg}').matches(path('/img/Logo.PNG'))).toBe(true);
    expect(new FilenamePattern('*.{png,jpg}').matches(path('/data.csv'))).toBe(false);
    expect(new FilenamePattern('?.ic').matches(path('/a.ic'))).toBe(true);
    expect(new FilenamePattern('diagrams/*.png').matches(path('/diagrams/a.png'))).toBe(true);
    expect(new FilenamePattern('diagrams/*.png').matches(path('/diagrams/sub/a.png'))).toBe(false);
    expect(new FilenamePattern('diagrams/**.png').matches(path('/diagrams/sub/a.png'))).toBe(true);
    expect(new FilenamePattern('a+b(1).txt').matches(path('/a+b(1).txt'))).toBe(true);
  });

  it('is as specific as the characters a name must have', () => {
    expect(new FilenamePattern('*').specificity).toBe(0);
    expect(new FilenamePattern('*.ic').specificity).toBe(3);
    expect(new FilenamePattern('*.{png,jpeg}').specificity).toBe(4);
    expect(new FilenamePattern('*.drawio.png').specificity).toBe(11);
  });
});

describe('CustomEditors', () => {
  it('opens a file in the matching editor of the highest priority, then the most specific pattern', () => {
    const { editors, images, files, sheets, diagrams } = builtins(document.createElement('div'));
    show(editors, '/a.drawio.png');
    expect(diagrams.opened).toHaveLength(1);
    show(editors, '/a.png');
    expect(images.opened.map((o) => o.document.path)).toEqual(['/a.png']);
    show(editors, '/budget.ic');
    expect(sheets.opened).toHaveLength(1);
    show(editors, '/data.csv');
    expect(files.opened).toHaveLength(1);
    expect(diagrams.opened).toHaveLength(1);
  });

  it('with equal priority and specificity the editor registered first wins; option editors only when asked for', () => {
    const editors = new CustomEditors(document.createElement('div'));
    const first = provider();
    const second = provider();
    const optional = provider();
    editors.register('a.first', first.provider, { filenamePattern: '*.png', priority: 'default' });
    editors.register('a.second', second.provider, { filenamePattern: '*.PNG' });
    editors.register('a.optional', optional.provider, { filenamePattern: '*.drawio.png', priority: 'option' });
    show(editors, '/x.drawio.png');
    expect(first.opened).toHaveLength(1);
    show(editors, '/x.drawio.png', 'a.optional');
    expect(optional.opened).toHaveLength(1);
    show(editors, '/x.drawio.png', 'a.second');
    expect(second.opened).toHaveLength(1);
    expect(() => editors.register('a.first', provider().provider, { filenamePattern: '*' })).toThrow(/registered already/);
  });

  it("gives a file the icon of the editor that opens it by default, not an option editor's", () => {
    const editors = new CustomEditors(document.createElement('div'));
    editors.register('a.any', provider().provider, { filenamePattern: '*', icon: '<svg id="any"/>' });
    editors.register('a.csv', provider().provider, { filenamePattern: '*.csv' });
    editors.register('a.table', provider().provider, { filenamePattern: '*.csv', priority: 'option', icon: '<svg id="table"/>' });
    expect(editors.iconOf(path('/notes.txt'))).toBe('<svg id="any"/>');
    expect(editors.iconOf(path('/data.csv'))).toBeUndefined();
  });

  it('gives every open a new panel in the editing area and disposes the shown one first', () => {
    const parent = document.createElement('div');
    const { editors, images } = builtins(parent);
    show(editors, '/a.png');
    const [first] = images.opened;
    expect(first.panel.element.parentElement).toBe(parent);
    expect(first.panel.element.dataset.viewType).toBe('images.preview');
    show(editors, '/a.png');
    expect(first.disposed).toBe(true);
    expect(first.panel.element.parentElement).toBeNull();
    expect(images.opened).toHaveLength(2);
    editors.show(null);
    expect(images.opened[1].disposed).toBe(true);
    expect(parent.children).toHaveLength(0);
  });

  it('shows nothing for a file no editor matches; disposing the provider or the editors disposes its panel', () => {
    const parent = document.createElement('div');
    const editors = new CustomEditors(parent);
    const sheets = provider();
    const registration = editors.register('spreadsheets.editor', sheets.provider, { filenamePattern: '*.ic' });
    show(editors, '/a.png');
    expect(parent.children).toHaveLength(0);
    show(editors, '/a.ic');
    registration.dispose();
    expect(sheets.opened[0].disposed).toBe(true);
    show(editors, '/a.ic');
    expect(sheets.opened).toHaveLength(1);
    const again = editors.register('spreadsheets.editor', sheets.provider, { filenamePattern: '*.ic' });
    show(editors, '/a.ic');
    editors.dispose();
    expect(sheets.opened[1].disposed).toBe(true);
    again.dispose();
  });
});
