// @vitest-environment jsdom
// Tests for file-panel.ts (the file panel, its tree and its menus), with the window's prompts and menus faked.
import { describe, expect, it, vi } from 'vitest';
import { FilePanel, type FilePanelPrompts } from './file-panel';
import type { FileChange } from '../../../core/project/project';
import { ProjectPath } from '../../../core/paths/paths';
import type { ContextMenuOptions, FileDecoration, InputBoxOptions, SaveDialogOptions } from '../../../hosts/window/window';

const path = ProjectPath.of;

const state = { paths: [path('/main.typ'), path('/chapter.typ'), path('/logo.png')], main: path('/main.typ'), active: path('/main.typ') };
const nested = {
  paths: [path('/main.typ'), path('/chapters/intro.typ'), path('/chapters/end.typ'), path('/img/logo.png'), path('/data.csv')],
  main: path('/main.typ'),
  active: path('/main.typ'),
};

function setup(onChange: (change: FileChange) => Promise<string | null> = async () => null, initial = state, decorations: Record<string, FileDecoration[]> = {}, hasNewEntries = true) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const onOpen = vi.fn();
  const change = vi.fn(onChange);
  const memory = { keys: () => [], get: vi.fn((_key: string, fallback?: unknown) => fallback), update: vi.fn(async () => {}) };
  /** What the user answers, in order: input boxes and warnings ('Delete' confirms). */
  const answers: (string | undefined)[] = [];
  const asked: InputBoxOptions[] = [];
  const saves: SaveDialogOptions[] = [];
  const warned: string[] = [];
  const errors: string[] = [];
  const prompts = {
    showInputBox: async (options: InputBoxOptions) => (asked.push(options), answers.shift()),
    showSaveDialog: async (options: SaveDialogOptions) => {
      saves.push(options);
      const answer = answers.shift();
      return answer === undefined ? undefined : ProjectPath.of(`/${answer}`);
    },
    showWarningMessage: async (message: string) => (warned.push(message), answers.shift()),
    showErrorMessage: async (message: string) => (errors.push(message), undefined),
    showContextMenu: (menuId: string, options: ContextMenuOptions) => void menus.push({ menuId, ...options }),
  } as unknown as FilePanelPrompts;
  const menus: (ContextMenuOptions & { menuId: string })[] = [];
  const panel = new FilePanel(
    parent,
    {
      onOpen,
      onChange: change,
      prompts,
      hasMenuItems: (menuId) => hasNewEntries && menuId === 'file/newFile',
      state: memory,
      decorations: (file) => decorations[file] ?? [],
      icon: (file) => (file.endsWith('.png') ? '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="4"/></svg>' : undefined),
    },
    initial,
  );
  const items = () => [...parent.querySelectorAll<HTMLElement>('[role=treeitem]')];
  const item = (name: string) => items().find((t) => t.title === name)!;
  return { parent, panel, onOpen, change, items, item, memory, answers, asked, saves, warned, errors, menus };
}

function press(target: HTMLElement, key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

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
    expect(memory.update).toHaveBeenLastCalledWith('openFolders', [path('/chapters')]);
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

  it('shows a Typst icon for Typst files, the icon a custom editor gives other files, else the icon for any file', () => {
    const { item } = setup(undefined, { ...state, paths: [path('/main.typ'), path('/logo.png'), path('/data.csv')] });
    const iconOf = (name: string) => item(name).querySelector('svg.typst-files__icon')!;
    expect(iconOf('logo.png').querySelector('circle')).not.toBeNull();
    expect(iconOf('main.typ').innerHTML).not.toBe(iconOf('data.csv').innerHTML);
    expect(iconOf('data.csv').querySelector('circle')).toBeNull();
  });

  it("shows the files' decorations as badges in their colors, propagated ones on closed folders too", () => {
    const ann: FileDecoration = { badge: 'AL', tooltip: 'Ann Lee', color: '#b58900', propagate: true };
    const bob: FileDecoration = { badge: 'B', tooltip: 'Bob', color: '#000080', propagate: true };
    const decorations: Record<string, FileDecoration[]> = { '/chapter.typ': [ann, bob], '/parts/a.typ': [bob, { badge: 'x', tooltip: 'local' }] };
    const files = { ...state, paths: [...state.paths, path('/parts/a.typ')] };
    const { parent, panel, item } = setup(undefined, files, decorations);
    const badges = [...item('chapter.typ').querySelectorAll<HTMLElement>('.typst-files__decoration')];
    expect(badges.map((badge) => [badge.textContent, badge.title])).toEqual([['AL', 'Ann Lee'], ['B', 'Bob']]);
    expect(badges[0].style.getPropertyValue('--typst-files-decoration-color')).toBe('#b58900');
    expect(badges[1].style.getPropertyValue('--typst-files-decoration-text')).toBe('#ffffff');
    expect(item('chapter.typ').querySelector('.typst-files__decorations')!.getAttribute('aria-label')).toBe('Ann Lee, Bob');
    expect(item('parts').querySelector('.typst-files__decorations')!.getAttribute('aria-label')).toBe('Bob');
    expect(item('main.typ').querySelector('.typst-files__decorations')).toBeNull();
    for (const file of Object.keys(decorations)) delete decorations[file];
    panel.render(files);
    expect(parent.querySelector('.typst-files__decorations')).toBeNull();
  });

  describe('menus', () => {
    const row = (resource: string, resourceKind = 'file', resourceIsMain = false) => ({ view: 'files', resource, resourceKind, resourceIsMain });

    it('"New" shows the window\'s file/newFile menu below it, for the focused row (its commands get the row)', () => {
      const { parent, item, menus } = setup(undefined, nested);
      item('chapters').click();
      const button = parent.querySelector<HTMLButtonElement>('button[aria-label=New]')!;
      expect(button.getAttribute('aria-haspopup')).toBe('menu');
      button.click();
      expect(menus).toEqual([{ menuId: 'file/newFile', anchor: button, title: 'New', context: row('/chapters', 'folder'), args: ['/chapters'] }]);
    });

    it('"New" is hidden while its menu has no entries', () => {
      const { parent } = setup(undefined, state, {}, false);
      expect(parent.querySelector<HTMLButtonElement>('button[aria-label=New]')!.hidden).toBe(true);
    });

    it("a right click shows the row's explorer/context menu at the pointer", () => {
      const { item, menus } = setup(undefined, nested);
      const contextMenu = (name: string) => {
        const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 6 });
        item(name).dispatchEvent(event);
        return event;
      };
      expect(contextMenu('chapters').defaultPrevented).toBe(true);
      contextMenu('main.typ');
      expect(menus).toEqual([
        { menuId: 'explorer/context', anchor: { x: 5, y: 6 }, title: 'chapters', context: row('/chapters', 'folder'), args: ['/chapters'] },
        { menuId: 'explorer/context', anchor: { x: 5, y: 6 }, title: 'main.typ', context: row('/main.typ', 'file', true), args: ['/main.typ'] },
      ]);
    });

    it('Shift+F10 and the context menu key show the context menu of the focused row, below it', () => {
      const { item, menus } = setup();
      press(item('main.typ'), 'Home'); // chapter.typ
      press(item('chapter.typ'), 'F10', { shiftKey: true });
      press(item('chapter.typ'), 'ContextMenu');
      expect(menus.map(({ anchor, args }) => [anchor, args])).toEqual([
        [item('chapter.typ'), ['/chapter.typ']],
        [item('chapter.typ'), ['/chapter.typ']],
      ]);
    });
  });

  describe('operations', () => {
    it('newFile asks where the new file goes (a save dialog: Typst unless named otherwise), creates it and opens it', async () => {
      const { panel, change, onOpen, answers, saves } = setup();
      answers.push('chapter 2.typ');
      await panel.newFile();
      expect(saves[0]).toEqual({ title: 'New file', defaultUri: undefined, filters: { Typst: ['typ'], 'All files': ['*'] } });
      expect(change).toHaveBeenCalledWith({ kind: 'create', path: '/chapter 2.typ', content: '' });
      expect(onOpen).toHaveBeenCalledWith('/chapter 2.typ');
    });

    it('starts new names in the folder of the row', async () => {
      const { panel, item, saves } = setup(undefined, nested);
      item('chapters').click();
      await panel.newFile();
      await panel.newFile(path('/img/logo.png'));
      expect(saves.map(({ defaultUri }) => defaultUri)).toEqual(['/chapters', '/img']);
    });

    it('makes a new (empty) folder that new files can go into', async () => {
      const { panel, change, item, answers, saves } = setup();
      answers.push('drafts');
      await panel.newFolder();
      expect(item('drafts').getAttribute('aria-expanded')).toBe('false');
      expect(change).not.toHaveBeenCalled();
      await panel.newFile();
      expect(saves[0].defaultUri).toBe('/drafts');
    });

    it('tells why a change was refused (an error message)', async () => {
      const { panel, answers, errors, onOpen } = setup(async () => 'This change is not allowed here.');
      answers.push('appendix.typ');
      await panel.newFile();
      expect(errors).toEqual(['This change is not allowed here.']);
      expect(onOpen).not.toHaveBeenCalled();
    });

    it('renames (the name selected without the extension) and deletes after a confirmation, but not the main file', async () => {
      const { panel, change, answers, asked, warned } = setup();
      await panel.rename(path('/main.typ'));
      await panel.delete(path('/main.typ'));
      expect([asked, warned]).toEqual([[], []]);
      panel.render({ ...state, active: path('/chapter.typ') });
      answers.push('intro', undefined, 'Delete');
      await panel.rename();
      expect(asked[0]).toMatchObject({ prompt: 'Rename chapter.typ to', value: 'chapter.typ', valueSelection: [0, 7] });
      expect(change).toHaveBeenCalledWith({ kind: 'rename', from: path('/chapter.typ'), path: path('/intro.typ') });
      change.mockClear();
      await panel.delete(path('/logo.png'));
      expect(change).not.toHaveBeenCalled(); // not confirmed
      await panel.delete(path('/logo.png'));
      expect(warned).toEqual(['Delete logo.png? This cannot be undone.', 'Delete logo.png? This cannot be undone.']);
      expect(change).toHaveBeenCalledWith({ kind: 'delete', path: path('/logo.png') });
    });

    it('renames and deletes a folder with everything in it', async () => {
      const { panel, change, answers, warned } = setup(undefined, nested);
      answers.push('parts', 'Delete');
      await panel.rename(path('/chapters'));
      expect(change.mock.calls.map(([c]) => c)).toEqual([
        { kind: 'rename', from: path('/chapters/intro.typ'), path: path('/parts/intro.typ') },
        { kind: 'rename', from: path('/chapters/end.typ'), path: path('/parts/end.typ') },
      ]);
      change.mockClear();
      await panel.delete(path('/img'));
      expect(warned).toEqual(['Delete img and the 1 files in it? This cannot be undone.']);
      expect(change.mock.calls.map(([c]) => c)).toEqual([{ kind: 'delete', path: path('/img/logo.png') }]);
    });
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
      const { item, change, answers, asked, warned } = setup();
      item('chapter.typ').focus();
      press(item('main.typ'), 'Home');
      press(item('chapter.typ'), 'F2');
      expect(asked[0].value).toBe('chapter.typ');
      answers.push('Delete');
      press(item('chapter.typ'), 'Delete');
      await tick();
      expect(warned[0]).toContain('Delete chapter.typ?');
      expect(change).toHaveBeenCalledWith({ kind: 'delete', path: path('/chapter.typ') });
    });

    it('F2 and Delete do nothing on the main file', () => {
      const { item, asked, warned } = setup();
      press(item('main.typ'), 'F2');
      press(item('main.typ'), 'Delete');
      expect([asked, warned]).toEqual([[], []]);
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

    it('a folder dragged onto the top level moves with its files; the main file stays (an error message)', async () => {
      const { item, change, panel, errors } = setup(undefined, { ...nested, paths: [...nested.paths, path('/img/old/a.png')] });
      panel.render({ ...nested, paths: [...nested.paths, path('/img/old/a.png')], active: path('/img/old/a.png') });
      const transfer = dataTransfer();
      dragEvent('dragstart', item('img/old'), transfer);
      dragEvent('drop', item('main.typ'), transfer);
      await vi.waitFor(() => expect(change).toHaveBeenCalledWith({ kind: 'rename', from: path('/img/old/a.png'), path: path('/old/a.png') }));
      change.mockClear();
      const main = dataTransfer();
      dragEvent('dragstart', item('main.typ'), main);
      dragEvent('drop', item('chapters'), main);
      await vi.waitFor(() => expect(errors).toEqual(['The main file stays where it is.']));
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

  describe('uploads', () => {
    // jsdom's File has no arrayBuffer()
    const png = Object.assign(new File([new Uint8Array([1])], 'cat.png', { type: 'image/png' }), {
      arrayBuffer: async () => new Uint8Array([1]).buffer,
    });

    it('puts files dropped on the widget at the top level, also while a folder is focused', async () => {
      const { panel, change, item } = setup(undefined, nested);
      item('img').focus();
      await panel.uploadFiles([png]);
      expect(change).toHaveBeenCalledWith(expect.objectContaining({ kind: 'create', path: path('/cat.png') }));
    });

    it('upload picks files for the folder of the row; a refusal is an error message', async () => {
      const { parent, panel, change, errors } = setup(async () => 'Too big.', nested);
      const picker = parent.querySelector<HTMLInputElement>('input[type=file]')!;
      const opened = vi.spyOn(picker, 'click').mockImplementation(() => {});
      panel.upload(path('/img/logo.png'));
      expect(opened).toHaveBeenCalled();
      Object.defineProperty(picker, 'files', { value: [png] });
      picker.dispatchEvent(new Event('change'));
      await vi.waitFor(() => expect(errors).toEqual(['Too big.']));
      expect(change).toHaveBeenCalledWith(expect.objectContaining({ kind: 'create', path: path('/img/cat.png') }));
    });
  });
});
