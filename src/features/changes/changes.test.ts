// @vitest-environment jsdom
// Tests for changes.ts.
import { describe, expect, it, vi } from 'vitest';
import { Project, type ProjectFiles } from '../../core/project/project';
import { ChangeTracking, type Base } from './changes';
import { ProjectPath } from '../../core/paths/paths';

const path = ProjectPath.of;

type Ranges = { from: number; to: number }[] | null;

function setup(files: ProjectFiles, base: Base | null = null) {
  const toolbar = document.createElement('div');
  const project = new Project(path('/main.typ'), files);
  const preview = vi.fn<(path: string, ranges: Ranges) => void>();
  const tracking = new ChangeTracking(toolbar, { project, preview }, base);
  const button = toolbar.querySelector<HTMLButtonElement>('button')!;
  /** Attaches a view to the document of `path`, as the widget does when it creates the views. */
  const view = (file: string) => {
    const shown = { showChanges: vi.fn<(base: string | null) => void>() };
    tracking.attach(project.document(ProjectPath.of(file))!, [shown]);
    return shown.showChanges;
  };
  /** The newest ranges the preview got, per path. */
  const marked = () => Object.fromEntries(preview.mock.calls.map(([path, ranges]) => [path, ranges]));
  const edit = (file: string, text: string) => project.document(ProjectPath.of(file))!.setText(text, 'test');
  return { project, tracking, button, preview, view, marked, edit };
}

describe('ChangeTracking', () => {
  it('without a base, compares with the text as opened; off until switched on', () => {
    const { button, view, preview, marked, edit } = setup({ '/main.typ': 'Hello world\n' });
    const main = view(path('/main.typ'));
    expect(button.textContent).toBe('Changes since opened');
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(main).toHaveBeenLastCalledWith(null);
    edit(path('/main.typ'), 'Hello big world\n');
    expect(preview).not.toHaveBeenCalled();
    button.click();
    expect(main).toHaveBeenLastCalledWith('Hello world\n');
    expect(marked()).toEqual({ '/main.typ': [{ from: 6, to: 10 }] });
  });

  it('every Typst file has its own base: its text as opened', () => {
    const { button, view, marked, edit } = setup({ '/main.typ': 'Main\n', '/a.typ': 'Alpha\n', '/b.typ': 'Beta\n', '/x.png': new Uint8Array() });
    edit(path('/a.typ'), 'Alpha one\n');
    button.click();
    expect(marked()).toEqual({ '/main.typ': [], '/a.typ': [{ from: 5, to: 9 }], '/b.typ': [] });
    edit(path('/b.typ'), 'Beta two\n');
    expect(marked()[path('/b.typ')]).toEqual([{ from: 4, to: 8 }]);
    expect(view(path('/a.typ'))).toHaveBeenLastCalledWith('Alpha\n');
  });

  it('a file created since opening is new as a whole; a deleted one is cleared in the preview', () => {
    const { project, button, marked } = setup({ '/main.typ': 'Main\n', '/a.typ': 'Alpha\n' });
    button.click();
    project.apply({ kind: 'create', path: path('/new.typ'), content: 'Fresh\n' });
    expect(marked()[path('/new.typ')]).toEqual([{ from: 0, to: 6 }]);
    project.apply({ kind: 'delete', path: path('/a.typ') });
    expect(marked()[path('/a.typ')]).toBeNull();
  });

  it('a renamed file keeps its base', () => {
    const { project, button, marked, edit } = setup({ '/main.typ': 'Main\n', '/a.typ': 'Alpha\n' });
    button.click();
    project.apply({ kind: 'rename', from: path('/a.typ'), path: path('/b.typ') });
    edit(path('/b.typ'), 'Alpha!\n');
    expect(marked()).toEqual({ '/main.typ': [], '/a.typ': null, '/b.typ': [{ from: 5, to: 6 }] });
  });

  it('"since opened" starts over when the texts arrive later (a collaboration room synced)', () => {
    const { tracking, button, view, edit } = setup({ '/main.typ': 'local copy\n', '/a.typ': 'local a\n' });
    edit(path('/main.typ'), 'Text of the room\n');
    edit(path('/a.typ'), 'A of the room\n');
    tracking.resetOpened();
    button.click();
    expect(view(path('/main.typ'))).toHaveBeenLastCalledWith('Text of the room\n');
    expect(view(path('/a.typ'))).toHaveBeenLastCalledWith('A of the room\n');
  });

  it('a given base (main file by default, or a path) is named in the button and shown at once', () => {
    const { tracking, button, view, marked } = setup({ '/main.typ': 'Hello big world\n', '/a.typ': 'Alpha beta\n' });
    const main = view(path('/main.typ'));
    tracking.setBase({ text: 'Hello world\n', label: 'last saved version' });
    expect(button.textContent).toBe('Changes since last saved version');
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(main).toHaveBeenLastCalledWith('Hello world\n');
    tracking.setBase({ text: 'Alpha\n', label: 'v2' }, path('/a.typ'));
    expect(button.textContent).toBe('Changes since v2');
    expect(marked()).toEqual({ '/main.typ': [{ from: 6, to: 10 }], '/a.typ': [{ from: 5, to: 10 }] });
    tracking.resetOpened();
    expect(main).toHaveBeenLastCalledWith('Hello world\n');
  });

  it('setBase(null) goes back to "since opened" for every file', () => {
    const { tracking, button, marked, edit } = setup({ '/main.typ': 'Hello\n' }, { text: 'Hi\n', label: 'v1' });
    edit(path('/main.typ'), 'Hello!\n');
    tracking.setBase(null);
    expect(button.textContent).toBe('Changes since opened');
    expect(marked()[path('/main.typ')]).toEqual([{ from: 5, to: 6 }]);
  });

  it('setBases: every path from one version; a path missing there is new as a whole', () => {
    const { tracking, button, marked } = setup({ '/main.typ': 'Main 2\n', '/a.typ': 'Alpha\n' });
    const commit: Record<string, string> = { '/main.typ': 'Main\n' };
    tracking.setBases('last saved version', (path) => commit[path] ?? null);
    expect(button.textContent).toBe('Changes since last saved version');
    expect(marked()).toEqual({ '/main.typ': [{ from: 4, to: 6 }], '/a.typ': [{ from: 0, to: 6 }] });
  });

  it('accepting a change moves the base of that file only', () => {
    const { project, tracking, button, view, marked } = setup({ '/main.typ': 'Main 2\n', '/a.typ': 'Alpha 2\n' });
    const commit: Record<string, string> = { '/main.typ': 'Main\n', '/a.typ': 'Alpha\n' };
    tracking.setBases('v1', (path) => commit[path] ?? null);
    const a = view(path('/a.typ'));
    tracking.accept(project.document(path('/a.typ'))!, 'Alpha 2\n');
    expect(button.textContent).toBe('Changes since v1');
    expect(a).toHaveBeenLastCalledWith('Alpha 2\n');
    expect(marked()).toEqual({ '/main.typ': [{ from: 4, to: 6 }], '/a.typ': [] });
  });

  it('the toggle hides and shows the changes again', () => {
    const { button, view, marked } = setup({ '/main.typ': 'Hello big world\n' }, { text: 'Hello world\n', label: 'v1' });
    const main = view(path('/main.typ'));
    button.click();
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(main).toHaveBeenLastCalledWith(null);
    expect(marked()[path('/main.typ')]).toBeNull();
    button.click();
    expect(main).toHaveBeenLastCalledWith('Hello world\n');
  });

  it('does not compute diffs for edits while changes are hidden', () => {
    const { button, edit, preview } = setup({ '/main.typ': 'Hello\n' }, { text: 'Hello\n', label: 'v1' });
    button.click();
    preview.mockClear();
    edit(path('/main.typ'), 'Hello there\n');
    expect(preview).not.toHaveBeenCalled();
  });
});
