// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { FileSwitcher } from './file-switcher';
import type { FileChange } from './project';

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

  it('can be hidden', () => {
    const { parent, switcher } = setup();
    switcher.visible = false;
    expect(parent.querySelector<HTMLElement>('.typst-files')!.hidden).toBe(true);
  });
});
