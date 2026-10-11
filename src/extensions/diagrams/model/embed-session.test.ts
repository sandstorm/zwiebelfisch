// Tests for embed-session.ts: the embed protocol (init → load, autosave → export → save, debounce, flush).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmbedSession, embedUrl, type EmbedAction } from './embed-session';
import { emptyDiagram, readDiagramXml, toDataUri, writeDiagramXml } from './png';

const xml = (label: string) => `<mxfile><diagram>${label}</diagram></mxfile>`;
/** What diagrams.net exports: a PNG with the diagram in it, as a data URI. */
const exported = (label: string) => ({ event: 'export', format: 'xmlpng', xml: xml(label), data: toDataUri(writeDiagramXml(emptyDiagram(), xml(label))) });

function setup(content = emptyDiagram()) {
  const sent: EmbedAction[] = [];
  const saved: Uint8Array[] = [];
  const session = new EmbedSession({ content, post: (message) => sent.push(message), save: (png) => saved.push(png), delay: 500 });
  // the editor speaks JSON strings (proto=json)
  const send = (message: object) => session.receive(JSON.stringify(message));
  const savedXml = () => saved.map(readDiagramXml);
  return { session, sent, saved, send, savedXml };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('EmbedSession', () => {
  it('loads the file as xmlpng with autosave when the editor is ready', () => {
    const { session, sent, send } = setup();
    expect(session.initialized).toBe(false);
    send({ event: 'init' });
    expect(session.initialized).toBe(true);
    expect(sent).toEqual([{ action: 'load', autosave: 1, xmlpng: toDataUri(emptyDiagram()) }]);
  });

  it('loads an empty diagram for a file that is no PNG (an empty file)', () => {
    const { sent, send } = setup(new Uint8Array());
    send({ event: 'init' });
    expect(sent).toEqual([{ action: 'load', autosave: 1, xml: '' }]);
  });

  it('asks for an xmlpng export on every change and saves the exported PNG once the changes pause', () => {
    const { sent, saved, send, savedXml } = setup();
    send({ event: 'init' });
    send({ event: 'autosave', xml: xml('a') });
    expect(sent.at(-1)).toEqual({ action: 'export', format: 'xmlpng' });
    send(exported('a'));
    vi.advanceTimersByTime(499);
    expect(saved).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(savedXml()).toEqual([xml('a')]);
  });

  it('exports one at a time: changes during an export ask for one more; the last export wins (debounced)', () => {
    const { sent, send, savedXml } = setup();
    send({ event: 'init' });
    send({ event: 'autosave', xml: xml('a') });
    send({ event: 'autosave', xml: xml('b') });
    send({ event: 'autosave', xml: xml('c') });
    expect(sent.filter((m) => m.action === 'export')).toHaveLength(1);
    send(exported('a'));
    expect(sent.filter((m) => m.action === 'export')).toHaveLength(2);
    vi.advanceTimersByTime(300);
    send(exported('c'));
    vi.advanceTimersByTime(300);
    expect(savedXml()).toEqual([]);
    vi.advanceTimersByTime(200);
    expect(savedXml()).toEqual([xml('c')]);
    // an export nobody asked for (another embed's) is ignored
    send(exported('x'));
    vi.runAllTimers();
    expect(savedXml()).toEqual([xml('c')]);
  });

  it('saves the pending export at once on flush (closed, disposed)', () => {
    const { session, send, savedXml } = setup();
    send({ event: 'init' });
    send({ event: 'save', xml: xml('a') });
    send(exported('a'));
    session.flush();
    expect(savedXml()).toEqual([xml('a')]);
    vi.runAllTimers();
    expect(savedXml()).toEqual([xml('a')]);
  });

  it('on flush, puts a diagram changed since the last export into the last PNG (the picture follows later)', () => {
    const { session, send, saved, savedXml } = setup();
    send({ event: 'init' });
    send({ event: 'autosave', xml: xml('a') });
    send(exported('a'));
    send({ event: 'autosave', xml: xml('b') });
    session.flush();
    expect(savedXml()).toEqual([xml('a'), xml('b')]);
    expect(saved[1].length).toBeGreaterThan(0);
    expect(session.content).toBe(saved[1]);
  });

  it('saves nothing for an unchanged diagram, nor for messages it does not know', () => {
    const { session, send, saved } = setup();
    send({ event: 'init' });
    send({ event: 'autosave', xml: readDiagramXml(emptyDiagram()) });
    send({ ...exported('x'), xml: readDiagramXml(emptyDiagram()) });
    session.receive('not json');
    session.receive({ event: 'exit', modified: false });
    session.receive(42);
    session.flush();
    vi.runAllTimers();
    expect(saved).toEqual([]);
  });
});

describe('embedUrl', () => {
  it('asks for embed mode with the JSON protocol, no Save / Exit buttons, light or dark', () => {
    const url = new URL(embedUrl('https://embed.diagrams.net/', { dark: true }));
    expect(url.origin).toBe('https://embed.diagrams.net');
    expect(Object.fromEntries(url.searchParams)).toEqual({ embed: '1', proto: 'json', spin: '1', noSaveBtn: '1', noExitBtn: '1', saveAndExit: '0', dark: '1' });
    expect(new URL(embedUrl('https://example.com/drawio/?lang=de', { dark: false })).searchParams.get('lang')).toBe('de');
  });
});
