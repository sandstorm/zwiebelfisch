// @vitest-environment jsdom
// Tests for status-bar.ts.
import { describe, expect, it } from 'vitest';
import { StatusBar } from './status-bar';

function setup() {
  const bar = document.createElement('div');
  const statusBar = new StatusBar(bar);
  const item = (text: string) => Object.assign(document.createElement('span'), { textContent: text });
  const side = (alignment: string) => [...bar.querySelector(`.zwf-editor__status-bar-${alignment}`)!.children].map((child) => child.textContent);
  return { bar, statusBar, item, side };
}

describe('StatusBar', () => {
  it('puts left items before the right ones, each side by priority (higher further left), then registration order', () => {
    const { bar, statusBar, item, side } = setup();
    statusBar.add(item('words'), { alignment: 'right' });
    statusBar.add(item('diagnostics'), { alignment: 'left', priority: 100 });
    statusBar.add(item('room'), { alignment: 'left', priority: 200 });
    statusBar.add(item('zoom'), { alignment: 'right', priority: 10 });
    statusBar.add(item('mode'), { alignment: 'left', priority: 100 });
    statusBar.add(item('cursor'), { alignment: 'right' });
    expect(side('left')).toEqual(['room', 'diagnostics', 'mode']);
    expect(side('right')).toEqual(['zoom', 'words', 'cursor']);
    expect([...bar.children].map((child) => child.className)).toEqual(['zwf-editor__status-bar-left', 'zwf-editor__status-bar-right']);
  });

  it('takes a disposed item out and keeps the others in order', () => {
    const { statusBar, item, side } = setup();
    statusBar.add(item('a'), { alignment: 'left', priority: 3 });
    const b = statusBar.add(item('b'), { alignment: 'left', priority: 2 });
    statusBar.add(item('c'), { alignment: 'left', priority: 1 });
    b.dispose();
    b.dispose();
    expect(side('left')).toEqual(['a', 'c']);
    statusBar.add(item('b again'), { alignment: 'left', priority: 2 });
    expect(side('left')).toEqual(['a', 'b again', 'c']);
  });

  it('is hidden while it has no item', () => {
    const { bar, statusBar, item } = setup();
    expect(bar.hidden).toBe(true);
    const left = statusBar.add(item('a'), { alignment: 'left' });
    const right = statusBar.add(item('b'), { alignment: 'right' });
    left.dispose();
    expect(bar.hidden).toBe(false);
    right.dispose();
    expect(bar.hidden).toBe(true);
  });
});
