// The playground bar above the demo editor: mode, example, room, user, server status. See main.ts.
import { EXAMPLES } from './examples';
import { MODES, exampleLink, modeQuery, otherUser, playgroundFromQuery, userQuery, type PlaygroundState } from './playground';
import { describeServer, type ServerState, type UpstreamChange } from './server-status';

export interface PlaygroundBar {
  /** Shows what is known about the server now. */
  setServer(state: ServerState): void;
  /** Shows, at the end of the bar, what became of the last edit (the Documentation example: saved to docs/ or not). */
  setSaveStatus(text: string, level: 'muted' | 'ok' | 'warn'): void;
}

export interface BarActions {
  /** Goes to another playground query, the open file staying open (a reload: the widget is set up once per page). */
  navigate(query: string): void;
  /** Has the fake GitLab commit a change; resolves with a line to show, rejects with why not. */
  simulateUpstream(change: UpstreamChange): Promise<string>;
}

/**
 * The demo's playground bar in `root`: example and mode switchers (links, so
 * every state has a URL), the user's name, a link that opens a second window
 * as another user in the same room, the server status with the command to
 * start it, and in GitLab mode "Simulate upstream commit".
 */
export function renderPlaygroundBar(root: HTMLElement, params: URLSearchParams, actions: BarActions): PlaygroundBar {
  const state = playgroundFromQuery(params);
  const status = new StatusLine(state);
  root.append(examplesNav(state, params), modesNav(state, params), userForm(state, params, actions));
  if (state.mode !== 'local') root.append(secondWindow(state, params));
  const upstream = state.mode === 'gitlab' ? upstreamControls(actions, status) : null;
  if (upstream) root.append(upstream.element);
  root.append(status.element);
  const save = el('span', { class: 'demo-bar__save', 'aria-live': 'polite', 'data-testid': 'save-status' });
  return {
    setServer(server) {
      status.server(server);
      if (upstream) upstream.button.disabled = server !== 'gitlab';
    },
    setSaveStatus(text, level) {
      if (!save.isConnected) root.append(save);
      save.textContent = text;
      save.dataset.level = level;
    },
  };
}

/** The status at the end of the bar: the server's state, the command to start it, the last action's result. */
class StatusLine {
  readonly element = el('span', { role: 'status', class: 'demo-bar__status' });
  private readonly state: PlaygroundState;

  constructor(state: PlaygroundState) {
    this.state = state;
    this.server(state.mode === 'local' ? null : 'checking');
  }

  server(server: ServerState | null): void {
    const { text, hint, level } = describeServer(this.state.mode, server);
    this.element.replaceChildren(text, ...(hint ? [' ', el('code', {}, hint)] : []));
    this.element.dataset.level = level;
  }

  note(text: string, level: 'ok' | 'warn'): void {
    this.element.querySelector('.demo-bar__note')?.remove();
    this.element.append(el('span', { class: 'demo-bar__note' }, ` ${text}`));
    this.element.dataset.level = level;
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attributes: Record<string, string>, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  element.append(...children);
  return element;
}

function examplesNav(state: PlaygroundState, params: URLSearchParams): HTMLElement {
  const fixed = state.mode === 'gitlab';
  return nav(
    'Examples',
    EXAMPLES.map(({ name, label }) => ({
      text: label,
      href: fixed ? null : exampleLink(name, params),
      current: !fixed && name === state.example,
      title: fixed ? 'In GitLab mode the repository decides the files' : undefined,
    })),
  );
}

function nav(label: string, links: { text: string; href: string | null; current: boolean; title?: string }[]): HTMLElement {
  const element = el('nav', { 'aria-label': label, class: 'demo-bar__group' }, el('span', { class: 'demo-bar__label' }, `${label}:`));
  for (const { text, href, current, title } of links) {
    const link = el('a', current ? { 'aria-current': 'page' } : {}, text);
    if (href === null) {
      // a disabled link: without href it has no role of its own
      link.setAttribute('role', 'link');
      link.setAttribute('aria-disabled', 'true');
    } else {
      link.setAttribute('href', href);
    }
    if (title) link.title = title;
    element.append(link);
  }
  return element;
}

function modesNav(state: PlaygroundState, params: URLSearchParams): HTMLElement {
  return nav(
    'Mode',
    MODES.map(({ mode, label }) => ({ text: label, href: modeQuery(mode, params), current: mode === state.mode })),
  );
}

function userForm(state: PlaygroundState, params: URLSearchParams, actions: BarActions): HTMLElement {
  const input = el('input', { name: 'user', size: '10', 'aria-label': 'Your name' });
  input.value = state.user;
  const form = el('form', { class: 'demo-bar__group', 'aria-label': 'User' }, el('span', { class: 'demo-bar__label' }, 'Name:'), input);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const user = input.value.trim();
    if (user && user !== state.user) actions.navigate(userQuery(user, params));
  });
  return form;
}

function secondWindow(state: PlaygroundState, params: URLSearchParams): HTMLElement {
  const other = otherUser(state.user);
  const link = el('a', { href: userQuery(other, params), target: '_blank', 'data-testid': 'second-window' }, `Open a second window as ${other}`);
  link.title = 'Same room, another user: try remote cursors and concurrent edits';
  return link;
}

function upstreamControls(actions: BarActions, status: StatusLine) {
  const select = el(
    'select',
    { 'aria-label': 'Upstream change' },
    el('option', { value: 'append' }, 'add a paragraph'),
    el('option', { value: 'heading' }, 'revise a heading'),
  );
  const button = el('button', { type: 'button' }, 'Simulate upstream commit');
  button.disabled = true;
  button.title = 'Commit a change to the fake repository, as a colleague pushing to GitLab would';
  button.addEventListener('click', () => {
    button.disabled = true;
    actions
      .simulateUpstream(select.value as UpstreamChange)
      .then((line) => status.note(line, 'ok'), (error: unknown) => status.note(`Simulating failed: ${(error as Error).message}`, 'warn'))
      .finally(() => (button.disabled = false));
  });
  return { element: el('span', { class: 'demo-bar__group' }, select, button), button };
}
