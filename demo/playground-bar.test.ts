// @vitest-environment jsdom
// Tests for playground-bar.ts.
import { describe, expect, it, vi } from 'vitest';
import { GITLAB_ROOM } from './playground';
import { renderPlaygroundBar, type BarActions } from './playground-bar';

function render(search: string, actions: Partial<BarActions> = {}, options = { server: true }) {
  const root = document.createElement('header');
  document.body.replaceChildren(root);
  const navigate = vi.fn<BarActions['navigate']>();
  const simulateUpstream = vi.fn<BarActions['simulateUpstream']>(async () => 'GitLab: abc “Add a paragraph”');
  const bar = renderPlaygroundBar(root, new URLSearchParams(search), { navigate, simulateUpstream, ...actions }, options);
  const nav = (label: string) => root.querySelector<HTMLElement>(`nav[aria-label="${label}"]`)!;
  const link = (label: string, text: string) => [...nav(label).querySelectorAll('a')].find((a) => a.textContent === text)!;
  const status = () => root.querySelector<HTMLElement>('[role="status"]')!;
  const button = () => [...root.querySelectorAll('button')].find((b) => b.textContent === 'Simulate upstream commit');
  return { root, bar, navigate, simulateUpstream, link, status, button };
}

describe('playground bar', () => {
  it('local mode: examples and modes as links, the current ones marked, no server talk', () => {
    const { link, status, button, root } = render('?example=simple');
    expect(link('Examples', 'Simple').getAttribute('aria-current')).toBe('page');
    expect(link('Mode', 'Local').getAttribute('aria-current')).toBe('page');
    expect(new URLSearchParams(link('Mode', 'Collaborate').search).get('room')).toBe('playground-simple');
    expect(new URLSearchParams(link('Mode', 'GitLab (fake)').search).get('room')).toBe(GITLAB_ROOM);
    expect(status().textContent).toMatch(/no server needed/);
    expect(button()).toBeUndefined();
    expect(root.querySelector('[data-testid="second-window"]')).toBeNull();
  });

  it('without a server (the static site): Collaborate and GitLab are shown, unavailable', () => {
    const { link } = render('?example=docs', {}, { server: false });
    expect(link('Mode', 'Local').getAttribute('aria-current')).toBe('page');
    for (const mode of ['Collaborate', 'GitLab (fake)']) {
      expect(link('Mode', mode).hasAttribute('href')).toBe(false);
      expect(link('Mode', mode).getAttribute('aria-disabled')).toBe('true');
      expect(link('Mode', mode).title).toMatch(/playground server/);
    }
    expect(link('Examples', 'Simple').hasAttribute('href')).toBe(true);
  });

  it('the name field reloads with the new user', () => {
    const { root, navigate } = render('?example=simple');
    const input = root.querySelector<HTMLInputElement>('input[name="user"]')!;
    expect(input.value).toBe('Demo user');
    input.value = 'Ada';
    root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(new URLSearchParams(navigate.mock.calls[0][0]).get('user')).toBe('Ada');
  });

  it('in a room: a second window joins as another user, and the status follows the server', () => {
    const { root, bar, status } = render('?room=r1&user=Ann');
    const second = root.querySelector<HTMLAnchorElement>('[data-testid="second-window"]')!;
    expect(second.target).toBe('_blank');
    expect(Object.fromEntries(new URLSearchParams(second.search))).toEqual({ room: 'r1', user: 'Bob' });
    expect(second.textContent).toContain('Bob');
    expect(status().textContent).toMatch(/Connecting/);
    bar.setServer('offline');
    expect(status().textContent).toContain('mise run demo');
    expect(status().dataset.level).toBe('warn');
  });

  it('GitLab mode: examples are disabled, the upstream simulation reports its commit', async () => {
    const { link, bar, button, simulateUpstream, root, status } = render(`?room=${encodeURIComponent(GITLAB_ROOM)}&user=Ann`);
    expect(link('Examples', 'Advanced').getAttribute('aria-disabled')).toBe('true');
    expect(link('Examples', 'Advanced').hasAttribute('href')).toBe(false);
    expect(button()!.disabled).toBe(true);
    bar.setServer('gitlab');
    expect(button()!.disabled).toBe(false);
    root.querySelector<HTMLSelectElement>('select[aria-label="Upstream change"]')!.value = 'heading';
    button()!.click();
    await vi.waitFor(() => expect(status().textContent).toContain('GitLab: abc'));
    expect(simulateUpstream).toHaveBeenCalledWith('heading');
  });

  it('a failed simulation shows why', async () => {
    const { bar, button, status } = render(`?room=${encodeURIComponent(GITLAB_ROOM)}`, {
      simulateUpstream: async () => {
        throw new Error('HTTP 404: nope');
      },
    });
    bar.setServer('gitlab');
    button()!.click();
    await vi.waitFor(() => expect(status().textContent).toContain('HTTP 404: nope'));
    expect(status().dataset.level).toBe('warn');
  });

  it('the save status (the Documentation example) appears at the end of the bar once set, and shows the latest', () => {
    const { bar, root } = render('?example=docs');
    expect(root.querySelector('[data-testid="save-status"]')).toBeNull();
    bar.setSaveStatus('Saving…', 'muted');
    bar.setSaveStatus('Saved to docs/main.typ', 'ok');
    const save = root.querySelector<HTMLElement>('[data-testid="save-status"]')!;
    expect(root.lastElementChild).toBe(save);
    expect(save.textContent).toBe('Saved to docs/main.typ');
    expect(save.dataset.level).toBe('ok');
  });
});
