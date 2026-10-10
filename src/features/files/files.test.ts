// @vitest-environment jsdom
// Tests for files.ts (the file panel and its tree).
import { describe, expect, it, vi } from 'vitest';
import { FilePanel } from './files';
import type { FileChange } from '../../core/project/project';
import { ProjectPath } from '../../core/paths/paths';

const path = ProjectPath.of;

const state = { paths: [path('/main.typ'), path('/chapter.typ'), path('/logo.png')], main: path('/main.typ'), active: path('/main.typ') };
const nested = {
  paths: [path('/main.typ'), path('/chapters/intro.typ'), path('/chapters/end.typ'), path('/img/logo.png'), path('/data.csv')],
  main: path('/main.typ'),
  active: path('/main.typ'),
};

function setup(onChange: (change: FileChange) => Promise<string | null> = async () => null, initial = state) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const onOpen = vi.fn();
  const change = vi.fn(onChange);
  const memory = { load: vi.fn(() => null), save: vi.fn() };
  const panel = new FilePanel(parent, parent, { onOpen, onChange: change, memory }, initial);
  const button = (name: string) =>
    [...parent.querySelectorAll('button')].find((b) => b.textContent?.trim() === name || b.title === name)!;
  const items = () => [...parent.querySelectorAll<HTMLElement>('[role=treeitem]')];
  const item = (name: string) => items().find((t) => t.title === name)!;
  return { parent, panel, onOpen, change, button, items, item, memory };
}

async function submit(parent: HTMLElement, value?: string) {
  const input = parent.querySelector<HTMLInputElement>('.typst-files__prompt input');
  if (value !== undefined) input!.value = value;
  parent.querySelector('form')!.requestSubmit();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function press(target: HTMLElement, key: string) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

describe('FilePanel', () => {
  it('lists the files as a tree, marks the main and the active one, and opens on click', () => {
    const { parent, onOpen, item, items } = setup();
    expect(parent.querySelector('[role=tree]')).not.toBeNull();
    expect(items().map((t) => t.title)).toEqual(['chapter.typ', 'logo.png', 'main.typ']);
    expect(item('main.typ').getAttribute('aria-selected')).toBe('true');
    expect(item('main.typ').textContent).toContain('Main');
    item('chapter.typ').click();
    expect(onOpen).toHaveBeenCalledWith(path('/chapter.typ'));
  });

  it('shows folders first, collapsed, and expands them on click (remembering it)', () => {
    const { item, items, memory } = setup(undefined, nested);
    expect(items().map((t) => t.title)).toEqual(['chapters', 'img', 'data.csv', 'main.typ']);
    expect(item('chapters').getAttribute('aria-expanded')).toBe('false');
    item('chapters').click();
    expect(items().map((t) => [t.title, t.getAttribute('aria-level')])).toEqual([
      ['chapters', '1'],
      ['chapters/end.typ', '2'],
      ['chapters/intro.typ', '2'],
      ['img', '1'],
      ['data.csv', '1'],
      ['main.typ', '1'],
    ]);
    expect(memory.save).toHaveBeenLastCalledWith([path('/chapters')]);
  });

  it('opens the folders around the shown file', () => {
    const { panel, item } = setup(undefined, nested);
    panel.render({ ...nested, active: path('/img/logo.png') });
    expect(item('img').getAttribute('aria-expanded')).toBe('true');
    expect(item('img/logo.png').getAttribute('aria-selected')).toBe('true');
  });

  it('marks files by kind', () => {
    const { item } = setup(undefined, nested);
    expect(item('data.csv').classList.contains('typst-files__row--file')).toBe(true);
    expect(item('chapters').classList.contains('typst-files__row--folder')).toBe(true);
  });

  it('marks the files other users are in with their initials in their color, closed folders too', () => {
    const { parent, panel, item } = setup(undefined, { ...state, paths: [...state.paths, path('/parts/a.typ')] });
    const ann = { id: '1', user: { name: 'Ann Lee', color: '#b58900' }, anchor: 0, head: 0 };
    const bob = { id: '2', user: { name: 'Bob', color: '#000080' }, anchor: 0, head: 0 };
    panel.showPresence([{ ...ann, path: path('/chapter.typ') }, { ...bob, path: path('/chapter.typ') }, { ...bob, path: path('/parts/a.typ') }]);
    const dots = [...item('chapter.typ').querySelectorAll<HTMLElement>('.typst-files__user')];
    expect(dots.map((dot) => [dot.textContent, dot.title])).toEqual([['AL', 'Ann Lee'], ['B', 'Bob']]);
    expect(dots[0].style.getPropertyValue('--typst-remote-color')).toBe('#b58900');
    expect(dots[1].style.getPropertyValue('--typst-remote-text')).toBe('#ffffff');
    expect(item('chapter.typ').querySelector('.typst-files__presence')!.getAttribute('aria-label')).toBe('Here: Ann Lee, Bob');
    expect(item('parts').querySelector('.typst-files__presence')!.getAttribute('aria-label')).toBe('Here: Bob');
    expect(item('main.typ').querySelector('.typst-files__presence')).toBeNull();
    panel.render({ ...state, paths: [...state.paths, path('/parts/a.typ')], active: path('/chapter.typ') });
    expect(item('chapter.typ').querySelectorAll('.typst-files__user')).toHaveLength(2);
    panel.showPresence([]);
    expect(parent.querySelector('.typst-files__presence')).toBeNull();
  });

  it('creates a .typ file from a typed name and opens it', async () => {
    const { parent, button, change, onOpen } = setup();
    button('New file').click();
    await submit(parent, 'chapter 2');
    expect(change).toHaveBeenCalledWith({ kind: 'create', path: '/chapter 2.typ', content: '' });
    expect(onOpen).toHaveBeenCalledWith('/chapter 2.typ');
    expect(parent.querySelector('.typst-files__prompt')).toBeNull();
  });

  it('creates new files in the focused folder', async () => {
    const { parent, button, change, item } = setup(undefined, nested);
    item('chapters').click();
    button('New file').click();
    const input = parent.querySelector<HTMLInputElement>('.typst-files__prompt input')!;
    expect(input.value).toBe('chapters/');
    await submit(parent, `${input.value}outro`);
    expect(change).toHaveBeenCalledWith({ kind: 'create', path: path('/chapters/outro.typ'), content: '' });
  });

  it('makes a new (empty) folder that new files can go into', async () => {
    const { parent, button, change, item } = setup();
    button('New folder').click();
    await submit(parent, 'drafts');
    expect(item('drafts').getAttribute('aria-expanded')).toBe('false');
    expect(change).not.toHaveBeenCalled();
    button('New file').click();
    expect(parent.querySelector<HTMLInputElement>('.typst-files__prompt input')!.value).toBe('drafts/');
  });

  it('shows why a change was refused and keeps the prompt open', async () => {
    const { parent, button } = setup(async () => '/chapter.typ already exists.');
    button('New file').click();
    await submit(parent, 'chapter');
    expect(parent.querySelector('.typst-files__error')?.textContent).toBe('/chapter.typ already exists.');
    await submit(parent, '');
    expect(parent.querySelector('.typst-files__error')?.textContent).toBe('Please enter a name.');
  });

  it('renames and deletes the focused file but not the main file', async () => {
    const { parent, panel, button, change } = setup();
    expect(button('Rename').disabled).toBe(true);
    expect(button('Delete').disabled).toBe(true);
    panel.render({ ...state, active: path('/chapter.typ') });
    button('Rename').click();
    expect(parent.querySelector<HTMLInputElement>('.typst-files__prompt input')!.value).toBe('chapter.typ');
    await submit(parent, 'intro');
    expect(change).toHaveBeenCalledWith({ kind: 'rename', from: path('/chapter.typ'), path: path('/intro.typ') });
    button('Delete').click();
    await submit(parent);
    expect(change).toHaveBeenCalledWith({ kind: 'delete', path: path('/chapter.typ') });
  });

  it('renames and deletes a folder with everything in it', async () => {
    const { parent, button, change, item } = setup(undefined, nested);
    item('chapters').click();
    button('Rename').click();
    await submit(parent, 'parts');
    expect(change.mock.calls.map(([c]) => c)).toEqual([
      { kind: 'rename', from: path('/chapters/intro.typ'), path: path('/parts/intro.typ') },
      { kind: 'rename', from: path('/chapters/end.typ'), path: path('/parts/end.typ') },
    ]);
    change.mockClear();
    item('img').click();
    button('Delete').click();
    expect(parent.querySelector('.typst-files__message')!.textContent).toBe('Delete img and the 1 files in it? This cannot be undone.');
    await submit(parent);
    expect(change.mock.calls.map(([c]) => c)).toEqual([{ kind: 'delete', path: path('/img/logo.png') }]);
  });

  it('cancels a prompt with Escape', () => {
    const { parent, button } = setup();
    button('New file').click();
    const input = parent.querySelector<HTMLInputElement>('.typst-files__prompt input')!;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(parent.querySelector('.typst-files__prompt')).toBeNull();
  });

  describe('keyboard', () => {
    it('arrow keys move through the rows, Right/Left open and close folders, Enter opens a file', () => {
      const { item, onOpen, parent } = setup(undefined, nested);
      const tree = parent.querySelector<HTMLElement>('[role=tree]')!;
      item('chapters').focus();
      expect(item('main.typ').tabIndex).toBe(0); // the shown file is the tab stop
      press(item('main.typ'), 'Home');
      expect(document.activeElement).toBe(item('chapters'));
      press(item('chapters'), 'ArrowRight');
      expect(item('chapters').getAttribute('aria-expanded')).toBe('true');
      press(item('chapters'), 'ArrowRight');
      expect(document.activeElement).toBe(item('chapters/end.typ'));
      press(item('chapters/end.typ'), 'ArrowDown');
      expect(document.activeElement).toBe(item('chapters/intro.typ'));
      const enter = press(item('chapters/intro.typ'), 'Enter');
      expect(enter.defaultPrevented).toBe(true);
      expect(onOpen).toHaveBeenCalledWith(path('/chapters/intro.typ'));
      press(item('chapters/intro.typ'), 'ArrowLeft');
      expect(document.activeElement).toBe(item('chapters'));
      press(item('chapters'), 'ArrowLeft');
      expect(item('chapters').getAttribute('aria-expanded')).toBe('false');
      expect(tree.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    });

    it('F2 renames and Delete deletes the focused row', async () => {
      const { item, parent, change } = setup();
      item('chapter.typ').focus();
      press(item('main.typ'), 'Home');
      press(item('chapter.typ'), 'F2');
      expect(parent.querySelector<HTMLInputElement>('.typst-files__prompt input')!.value).toBe('chapter.typ');
      press(item('chapter.typ'), 'Delete');
      expect(parent.querySelector('.typst-files__message')!.textContent).toContain('Delete chapter.typ?');
      await submit(parent);
      expect(change).toHaveBeenCalledWith({ kind: 'delete', path: path('/chapter.typ') });
    });

    it('F2 and Delete do nothing on the main file', () => {
      const { item, parent } = setup();
      press(item('main.typ'), 'F2');
      press(item('main.typ'), 'Delete');
      expect(parent.querySelector('.typst-files__prompt')).toBeNull();
    });
  });

  describe('drag and drop in the tree', () => {
    function dataTransfer(data: Record<string, string> = {}, files: File[] = []) {
      const store = { ...data };
      return {
        files,
        get types() {
          return [...Object.keys(store), ...(files.length ? ['Files'] : [])];
        },
        setData: (type: string, value: string) => (store[type] = value),
        getData: (type: string) => store[type] ?? '',
        effectAllowed: 'all',
      };
    }

    function dragEvent(type: string, target: HTMLElement, transfer: ReturnType<typeof dataTransfer>) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: transfer });
      target.dispatchEvent(event);
      return event;
    }

    it('a file dragged onto a folder moves into it', async () => {
      const { item, change } = setup(undefined, nested);
      const transfer = dataTransfer();
      dragEvent('dragstart', item('data.csv'), transfer);
      expect(dragEvent('dragover', item('img'), transfer).defaultPrevented).toBe(true);
      expect(item('img').classList.contains('typst-files__row--drop')).toBe(true);
      dragEvent('drop', item('img'), transfer);
      await vi.waitFor(() => expect(change).toHaveBeenCalledWith({ kind: 'rename', from: path('/data.csv'), path: path('/img/data.csv') }));
    });

    it('a folder dragged onto the top level moves with its files; the main file stays', async () => {
      const { item, change, panel, parent } = setup(undefined, { ...nested, paths: [...nested.paths, path('/img/old/a.png')] });
      panel.render({ ...nested, paths: [...nested.paths, path('/img/old/a.png')], active: path('/img/old/a.png') });
      const transfer = dataTransfer();
      dragEvent('dragstart', item('img/old'), transfer);
      dragEvent('drop', item('main.typ'), transfer);
      await vi.waitFor(() => expect(change).toHaveBeenCalledWith({ kind: 'rename', from: path('/img/old/a.png'), path: path('/old/a.png') }));
      change.mockClear();
      const main = dataTransfer();
      dragEvent('dragstart', item('main.typ'), main);
      dragEvent('drop', item('chapters'), main);
      await vi.waitFor(() => expect(parent.querySelector('.typst-files__message')?.textContent).toBe('The main file stays where it is.'));
      expect(change).not.toHaveBeenCalled();
    });

    it('files from the computer dropped onto a folder are uploaded into it (and not once more by the widget)', async () => {
      const png = Object.assign(new File([new Uint8Array([1])], 'cat.png', { type: 'image/png' }), {
        arrayBuffer: async () => new Uint8Array([1]).buffer,
      });
      const { item, change } = setup(undefined, nested);
      dragEvent('drop', item('img'), dataTransfer({}, [png]));
      await vi.waitFor(() => expect(change).toHaveBeenCalledWith(expect.objectContaining({ kind: 'create', path: path('/img/cat.png') })));
      expect(change).toHaveBeenCalledTimes(1);
    });
  });

  describe('files dropped on the widget', () => {
    // jsdom's File has no arrayBuffer()
    const png = Object.assign(new File([new Uint8Array([1])], 'cat.png', { type: 'image/png' }), {
      arrayBuffer: async () => new Uint8Array([1]).buffer,
    });

    function drop(target: HTMLElement, files: File[]) {
      const event = new Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: { files, types: ['Files'] } });
      target.dispatchEvent(event);
      return event;
    }

    function enter(target: HTMLElement) {
      const event = new Event('dragenter', { bubbles: true });
      Object.defineProperty(event, 'dataTransfer', { value: { types: ['Files'] } });
      target.dispatchEvent(event);
    }

    it('are uploaded and the hint goes away', async () => {
      const { parent, change } = setup();
      enter(parent);
      expect(parent.classList.contains('typst-editor--dropping')).toBe(true);
      expect(drop(parent, [png]).defaultPrevented).toBe(true);
      await vi.waitFor(() => expect(change).toHaveBeenCalledWith(expect.objectContaining({ kind: 'create', path: path('/cat.png') })));
      expect(parent.classList.contains('typst-editor--dropping')).toBe(false);
    });

    it('are left to a view inside that takes them (e.g. images dropped into the text); the hint goes away', async () => {
      const { parent, change } = setup();
      const view = parent.appendChild(document.createElement('div'));
      view.addEventListener('drop', (event) => (event.preventDefault(), event.stopPropagation()));
      enter(view);
      drop(view, [png]);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(change).not.toHaveBeenCalled();
      expect(parent.classList.contains('typst-editor--dropping')).toBe(false);
    });

    it('never make the browser leave the page, also while drops are not accepted', async () => {
      const { parent, panel, change } = setup();
      panel.acceptDrops = false;
      const over = new Event('dragover', { bubbles: true, cancelable: true });
      Object.defineProperty(over, 'dataTransfer', { value: { types: ['Files'] } });
      parent.dispatchEvent(over);
      expect(over.defaultPrevented).toBe(true);
      expect(drop(parent, [png]).defaultPrevented).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(change).not.toHaveBeenCalled();
    });
  });
});
