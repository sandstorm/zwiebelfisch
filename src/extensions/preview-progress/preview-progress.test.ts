// @vitest-environment jsdom
// Tests for preview-progress.ts in the composed hosts (Widget) (preview mocked: no worker in jsdom; `preview` tells its load events):
// the loading note over the empty pane, its progress bar, a failure as an error message once, gone with the first pages.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectPath } from '../../core/paths/paths';
import { Project } from '../../core/project/project';
import type { EngineCrash, LoadEvent } from '../../hosts/preview/preview';
import { SOURCE_EDITOR } from '../../hosts/source-editor/source-editor';
import { Widget } from '../../editor/widget/widget';
import { previewProgress } from './preview-progress';

/** The (mocked) preview made last: fire its events, set whether it shows something. */
const preview = vi.hoisted(() => ({
  load: (_event: LoadEvent): void => {},
  crash: (_crash: EngineCrash): void => {},
  compiled: (): void => {},
  render: (): void => {},
  isEmpty: true,
}));

vi.mock('../../hosts/preview/preview', async (importOriginal) => {
  const { Disposable } = await import('../../core/disposable/disposable');
  const { EventEmitter } = await import('../../core/event-emitter/event-emitter');
  return {
    ...(await importOriginal<object>()),
    Preview: class {
      readonly #loads = new EventEmitter<LoadEvent>();
      readonly #crashes = new EventEmitter<EngineCrash>();
      readonly #diagnostics = new EventEmitter<readonly unknown[]>();
      readonly #renders = new EventEmitter<void>();
      readonly onDidLoad = this.#loads.event;
      readonly onDidCrash = this.#crashes.event;
      readonly onDidChangeDiagnostics = this.#diagnostics.event;
      readonly onDidRender = this.#renders.event;
      readonly onDidChangeRenderers = new EventEmitter<void>().event;
      readonly #pane: HTMLElement;
      constructor(parent: HTMLElement) {
        this.#pane = parent.appendChild(document.createElement('div'));
        Object.assign(preview, {
          load: (event: LoadEvent) => this.#loads.fire(event),
          crash: (crash: EngineCrash) => this.#crashes.fire(crash),
          compiled: () => this.#diagnostics.fire([]),
          render: () => this.#renders.fire(),
          isEmpty: true,
        });
      }
      get isEmpty() {
        return preview.isEmpty;
      }
      registerPaneOverlay(element: HTMLElement) {
        this.#pane.append(element);
        return new Disposable(() => element.remove());
      }
      update() {}
      reveal() {}
      snippet = async () => null;
      dispose() {}
    },
  };
});

const path = ProjectPath.of;

function setup() {
  const host = document.body.appendChild(document.createElement('div'));
  const project = new Project(path('/main.typ'), { '/main.typ': '= Main\n' });
  const widget = new Widget(host, project, { viewType: SOURCE_EDITOR });
  widget.activate([previewProgress()]);
  const note = host.querySelector<HTMLElement>('[data-testid=zwf-preview-progress]')!;
  const errors = () => [...host.querySelectorAll('[data-testid=zwf-notifications] [role=alert]')].map((error) => error.textContent);
  return { host, note, errors };
}

afterEach(() => {
  document.body.replaceChildren();
  sessionStorage.clear();
});

describe('previewProgress', () => {
  it('shows the engine download over the empty pane, then "Compiling…", and goes once the first pages are there', () => {
    const { host, note } = setup();
    const status = note.querySelector('[role=status]')!;
    const bar = note.querySelector('[role=progressbar]')!;
    expect(note.hidden).toBe(false);
    expect(status.textContent).toBe('Loading the Typst compiler…');

    preview.load({ kind: 'engine', loaded: 3_100_000, total: 6_600_000 });
    expect(note.textContent).toContain('3.1 / 6.6 MB');
    expect(bar.getAttribute('aria-valuenow')).toBe('47');
    expect(bar.getAttribute('aria-valuetext')).toBe('3.1 / 6.6 MB');
    expect(host.querySelector('.zwf-editor__status-bar')!.textContent).not.toContain('Loading');

    preview.load({ kind: 'ready' });
    expect(status.textContent).toBe('Compiling…');
    expect(bar.hasAttribute('aria-valuenow')).toBe(false);

    preview.load({ kind: 'packages', specs: ['@preview/merman:0.4.0'] });
    expect(note.textContent).toContain('Downloading @preview/merman 0.4.0…');
    preview.isEmpty = false;
    preview.render();
    expect(note.hidden).toBe(true);
  });

  it('says so when the engine cannot be loaded, in the pane and as one error message', () => {
    const { note, errors } = setup();
    preview.load({ kind: 'failed', message: 'HTTP 404' });
    preview.load({ kind: 'font', name: 'NewCM.otf' });
    expect(note.textContent).toContain('The Typst compiler could not be loaded.');
    expect(note.textContent).toContain('HTTP 404');
    expect(note.querySelector<HTMLElement>('[role=progressbar]')!.hidden).toBe(true);
    expect(errors()).toEqual([expect.stringContaining('The Typst compiler could not be loaded. HTTP 404')]);
  });

  it('tells each crash as an error message, and the new engine loading after it', () => {
    const { note, errors } = setup();
    preview.load({ kind: 'ready' });
    preview.compiled();
    expect(note.hidden).toBe(true);
    preview.crash({ message: 'capacity overflow', restarting: true });
    preview.load({ kind: 'starting' });
    expect(note.textContent).toContain('Loading the Typst compiler…');
    preview.load({ kind: 'ready' });
    preview.crash({ message: 'capacity overflow', restarting: false });
    expect(note.textContent).toContain('crashed again');
    expect(errors()).toEqual([
      expect.stringContaining('The Typst compiler crashed and was restarted. capacity overflow'),
      expect.stringContaining('The Typst compiler crashed again; it starts again with the next edit. capacity overflow'),
    ]);
  });
});
