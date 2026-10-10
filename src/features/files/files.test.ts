// @vitest-environment jsdom
// Tests for files.ts.
import { describe, expect, it, vi } from 'vitest';
import { FileSwitcher } from './files';
import type { FileChange } from '../../core/project/project';

const state = { paths: ['/main.typ', '/chapter.typ', '/logo.png'], main: '/main.typ', active: '/main.typ' };

function setup(onChange: (change: FileChange) => Promise<string | null> = async () => null) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const onOpen = vi.fn();
  const change = vi.fn(onChange);
  const switcher = new FileSwitcher(parent, parent, { onOpen, onChange: change });
  switcher.render(state);
  const button = (name: string) =>
    [...parent.querySelectorAll('button')].find((b) => b.textContent?.trim() === name || b.title === name)!;
  const tab = (name: string) => [...parent.querySelectorAll<HTMLElement>('[role=tab]')].find((t) => t.title === name)!;
  return { parent, switcher, onOpen, change, button, tab };
}

async function submit(parent: HTMLElement, value?: string) {
  const input = parent.querySelector<HTMLInputElement>('.typst-files__prompt input');
  if (value !== undefined) input!.value = value;
  parent.querySelector('form')!.requestSubmit();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('FileSwitcher', () => {
  it('lists the files, marks the main and the active one, and opens on click', () => {
    const { parent, onOpen, tab } = setup();
    const tabs = parent.querySelectorAll('[role=tab]');
    expect([...tabs].map((t) => t.getAttribute('title'))).toEqual(['main.typ', 'chapter.typ', 'logo.png']);
    expect(tab('main.typ').getAttribute('aria-selected')).toBe('true');
    expect(tab('main.typ').textContent).toContain('Main');
    tab('chapter.typ').click();
    expect(onOpen).toHaveBeenCalledWith('/chapter.typ');
  });

  it('marks the files other users are in with their initials in their color', () => {
    const { parent, switcher, tab } = setup();
    const ann = { id: '1', user: { name: 'Ann Lee', color: '#b58900' }, anchor: 0, head: 0 };
    const bob = { id: '2', user: { name: 'Bob', color: '#000080' }, anchor: 0, head: 0 };
    switcher.showPresence([{ ...ann, path: '/chapter.typ' }, { ...bob, path: '/chapter.typ' }]);
    const dots = [...tab('chapter.typ').querySelectorAll<HTMLElement>('.typst-files__user')];
    expect(dots.map((dot) => [dot.textContent, dot.title])).toEqual([['AL', 'Ann Lee'], ['B', 'Bob']]);
    expect(dots[0].style.getPropertyValue('--typst-remote-color')).toBe('#b58900');
    expect(dots[1].style.getPropertyValue('--typst-remote-text')).toBe('#ffffff');
    expect(tab('chapter.typ').querySelector('.typst-files__presence')!.getAttribute('aria-label')).toBe('Here: Ann Lee, Bob');
    expect(tab('main.typ').querySelector('.typst-files__presence')).toBeNull();
    switcher.render({ ...state, active: '/chapter.typ' });
    expect(tab('chapter.typ').querySelectorAll('.typst-files__user')).toHaveLength(2);
    switcher.showPresence([]);
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

  it('shows why a change was refused and keeps the prompt open', async () => {
    const { parent, button } = setup(async () => '/chapter.typ already exists.');
    button('New file').click();
    await submit(parent, 'chapter');
    expect(parent.querySelector('.typst-files__error')?.textContent).toBe('/chapter.typ already exists.');
    await submit(parent, '');
    expect(parent.querySelector('.typst-files__error')?.textContent).toBe('Please enter a name.');
  });

  it('renames and deletes the active file but not the main file', async () => {
    const { parent, switcher, button, change } = setup();
    expect(button('Rename').disabled).toBe(true);
    expect(button('Delete').disabled).toBe(true);
    switcher.render({ ...state, active: '/chapter.typ' });
    button('Rename').click();
    expect(parent.querySelector<HTMLInputElement>('.typst-files__prompt input')!.value).toBe('chapter.typ');
    await submit(parent, 'intro');
    expect(change).toHaveBeenCalledWith({ kind: 'rename', from: '/chapter.typ', path: '/intro.typ' });
    button('Delete').click();
    await submit(parent);
    expect(change).toHaveBeenCalledWith({ kind: 'delete', path: '/chapter.typ' });
  });

  it('cancels a prompt with Escape', () => {
    const { parent, button } = setup();
    button('New file').click();
    const input = parent.querySelector<HTMLInputElement>('.typst-files__prompt input')!;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(parent.querySelector('.typst-files__prompt')).toBeNull();
  });

  describe('dropped files', () => {
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
      await vi.waitFor(() => expect(change).toHaveBeenCalledWith(expect.objectContaining({ kind: 'create', path: '/cat.png' })));
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

    it('never make the browser leave the page, also while the file bar is hidden', async () => {
      const { parent, switcher, change } = setup();
      switcher.visible = false;
      const over = new Event('dragover', { bubbles: true, cancelable: true });
      Object.defineProperty(over, 'dataTransfer', { value: { types: ['Files'] } });
      parent.dispatchEvent(over);
      expect(over.defaultPrevented).toBe(true);
      expect(drop(parent, [png]).defaultPrevented).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(change).not.toHaveBeenCalled();
    });
  });

  it('can be hidden', () => {
    const { parent, switcher } = setup();
    switcher.visible = false;
    expect(parent.querySelector<HTMLElement>('.typst-files')!.hidden).toBe(true);
  });
});
