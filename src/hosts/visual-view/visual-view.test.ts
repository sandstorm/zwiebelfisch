// @vitest-environment jsdom
// Tests for visual-view.ts.
import { describe, expect, it } from 'vitest';
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import { type Highlight, TypstDocument } from '../../core/typst-document/typst-document';
import { createVisualView } from './test-support';
import { VisualView, VisualViewContributions } from './visual-view';

function setup(text: string) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const doc = new TypstDocument(text);
  const view = createVisualView(parent, doc);
  const editable = parent.querySelector<HTMLElement>('[contenteditable]')!;
  return { doc, view, editable, parent };
}

function press(target: HTMLElement, key: string) {
  const mac = /Mac/.test(navigator.platform);
  const event = new KeyboardEvent('keydown', { key, metaKey: mac, ctrlKey: !mac, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

describe('VisualView', () => {
  it('renders the projected document', () => {
    const { parent } = setup('= Title\n\nSome *bold* text.\n');
    expect(parent.querySelector('h1')?.textContent).toBe('Title');
    expect(parent.querySelector('strong')?.textContent).toBe('bold');
  });

  it('handles Mod-b and Mod-i itself instead of letting the browser act', () => {
    const { editable } = setup('Hello\n');
    editable.focus();
    expect(press(editable, 'b').defaultPrevented).toBe(true);
    expect(press(editable, 'i').defaultPrevented).toBe(true);
  });

  it('reveals a source range by selecting exactly what shows it', () => {
    const source = '= Title\n\nSome *bold* text.\n';
    const { view } = setup(source);
    view.reveal(source.indexOf('bold'), source.indexOf('bold') + 4);
    expect(window.getSelection()?.toString()).toBe('bold');
  });

  it('draws highlights given in source offsets over the visible text', () => {
    const source = '= Title\n\nSome *bold* text.\n';
    const { view, parent } = setup(source);
    const from = source.indexOf('bold');
    view.setHighlights('cursors', [{ from: from - 1, to: from + 5, className: 'note', attributes: { 'data-user': 'a' } }]);
    expect([...parent.querySelectorAll('.note[data-user="a"]')].map((e) => e.textContent).join('')).toBe('bold');
    view.setHighlights('cursors', []);
    expect(parent.querySelector('.note')).toBeNull();
  });

  it('keeps highlights on their text through edits from elsewhere', () => {
    const source = 'Some bold text\n';
    const { doc, view, parent } = setup(source);
    view.setHighlights('cursors', [{ from: 5, to: 9, className: 'note' }]);
    doc.setText(`Really. ${source}`, 'source');
    expect(parent.querySelector('.note')?.textContent).toBe('bold');
  });

  it('reports the selection as the source range it shows', () => {
    const source = '= Title\n\nSome *bold* text.\n';
    const { view } = setup(source);
    const from = source.indexOf('bold');
    view.reveal(from, from + 4);
    expect(view.selection()).toEqual({ from, to: from + 4 });
  });

  it('follows document changes made elsewhere', () => {
    const { doc, parent } = setup('= Title\n\nText\n');
    doc.setText('= Title\n\nText changed\n', 'source');
    expect(parent.querySelector('p')?.textContent).toBe('Text changed');
  });
});

describe('VisualViewContributions.registerHighlights', () => {
  it('sets a provider\'s highlights when a view is made and again when they change for its document only', () => {
    const changed = new EventEmitter<TypstDocument>();
    const ranges = new Map<TypstDocument, Highlight[]>();
    const contributions = new VisualViewContributions();
    contributions.registerHighlights('test', { provideHighlights: (document) => ranges.get(document) ?? [], onDidChangeHighlights: changed.event });
    const doc = new TypstDocument('Hello world\n');
    const other = new TypstDocument('Other\n');
    ranges.set(doc, [{ from: 0, to: 5, className: 'marked' }]);
    const parent = document.body.appendChild(document.createElement('div'));
    const view = new VisualView(parent, doc, contributions);
    expect(parent.querySelector('.marked')?.textContent).toBe('Hello');
    ranges.set(doc, [{ from: 6, to: 11, className: 'marked' }]);
    changed.fire(other);
    expect(parent.querySelector('.marked')?.textContent).toBe('Hello');
    changed.fire(doc);
    expect(parent.querySelector('.marked')?.textContent).toBe('world');
    view.destroy();
    expect(changed.hasListeners).toBe(false);
  });
});
