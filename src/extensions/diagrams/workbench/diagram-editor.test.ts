// @vitest-environment jsdom
// Tests for diagram-editor.ts: the iframe's window is faked (messages in, postMessage out), timers too.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectPath } from '../../../core/paths/paths';
import { emptyDiagram, readDiagramXml, toDataUri, writeDiagramXml } from '../model/png';
import { DiagramEditor, type DiagramEditorOptions } from './diagram-editor';

const xml = (label: string) => `<mxfile><diagram>${label}</diagram></mxfile>`;

function setup(options: Partial<DiagramEditorOptions> = {}, scheme = 'light') {
  const host = document.createElement('div');
  host.dataset.scheme = scheme;
  const parent = host.appendChild(document.createElement('div'));
  document.body.append(host);
  const saved: Uint8Array[] = [];
  const failed = vi.fn(async () => false);
  const editor = new DiagramEditor(parent, {
    path: ProjectPath.of('/img/flow.drawio.png'),
    content: emptyDiagram(),
    editorUrl: 'https://embed.diagrams.net/',
    save: (png) => saved.push(png),
    failed,
    ...options,
  });
  const frame = () => parent.querySelector('iframe');
  const posted = vi.spyOn(frame()!.contentWindow!, 'postMessage');
  /** A message from the editor in the iframe. */
  const send = (message: object, source: Window | null = frame()!.contentWindow) =>
    window.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message), source }));
  const sent = () => posted.mock.calls.map(([message, origin]) => ({ ...JSON.parse(message as string), origin }));
  const status = () => parent.querySelector<HTMLElement>('.typst-diagrams__status')!;
  return { host, parent, editor, saved, failed, frame, send, sent, status };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('DiagramEditor', () => {
  it('loads diagrams.net in embed mode and speaks the protocol with it, only with its own iframe', () => {
    const { frame, send, sent, status } = setup();
    const url = new URL(frame()!.src);
    expect(url.origin + url.pathname).toBe('https://embed.diagrams.net/');
    expect(url.searchParams.get('proto')).toBe('json');
    expect(url.searchParams.get('dark')).toBe('0');
    expect(status().hidden).toBe(false);
    send({ event: 'init' }, null);
    expect(sent()).toEqual([]);
    send({ event: 'init' });
    expect(sent()).toEqual([{ action: 'load', autosave: 1, xmlpng: toDataUri(emptyDiagram()), origin: 'https://embed.diagrams.net' }]);
    expect(status().hidden).toBe(true);
  });

  it('saves every change (debounced) and what is pending when disposed', () => {
    const { editor, send, sent, saved, parent } = setup();
    send({ event: 'init' });
    send({ event: 'autosave', xml: xml('a') });
    expect(sent().at(-1)).toMatchObject({ action: 'export', format: 'xmlpng' });
    send({ event: 'export', format: 'xmlpng', xml: xml('a'), data: toDataUri(writeDiagramXml(emptyDiagram(), xml('a'))) });
    vi.runAllTimers();
    expect(saved.map(readDiagramXml)).toEqual([xml('a')]);
    send({ event: 'autosave', xml: xml('b') });
    send({ event: 'export', format: 'xmlpng', xml: xml('b'), data: toDataUri(writeDiagramXml(emptyDiagram(), xml('b'))) });
    editor.dispose();
    expect(saved.map(readDiagramXml)).toEqual([xml('a'), xml('b')]);
    expect(parent.children).toHaveLength(0);
  });

  it('follows the widget into dark mode: saves what is pending and loads the editor again, dark', async () => {
    const { host, frame, send, saved } = setup();
    send({ event: 'init' });
    send({ event: 'autosave', xml: xml('a') });
    send({ event: 'export', format: 'xmlpng', xml: xml('a'), data: toDataUri(writeDiagramXml(emptyDiagram(), xml('a'))) });
    host.dataset.scheme = 'dark';
    await vi.waitFor(() => expect(new URL(frame()!.src).searchParams.get('dark')).toBe('1'));
    expect(saved.map(readDiagramXml)).toEqual([xml('a')]);
  });

  it('says when the editor does not answer in time, and shows the picture if asked to', async () => {
    const createObjectURL = vi.fn(() => 'blob:diagram');
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }); // jsdom has neither
    const failed = vi.fn(async () => true);
    const { frame, parent, status } = setup({ failed, loadTimeout: 1000 });
    vi.advanceTimersByTime(999);
    expect(status().textContent).toBe('Loading the diagram editor…');
    vi.advanceTimersByTime(1);
    await vi.waitFor(() => expect(frame()).toBeNull());
    expect(failed).toHaveBeenCalledTimes(1);
    expect(parent.querySelector('img')?.getAttribute('src')).toBe('blob:diagram');
  });

  it('does not complain once the editor answered', async () => {
    const { failed, send } = setup({ loadTimeout: 1000 });
    send({ event: 'init' });
    vi.advanceTimersByTime(5000);
    expect(failed).not.toHaveBeenCalled();
  });
});
