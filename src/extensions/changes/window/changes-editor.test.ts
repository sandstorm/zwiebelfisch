// @vitest-environment jsdom
// Tests for changes-editor.ts.
import { describe, expect, it } from 'vitest';
import { ChangesEditor } from './changes-editor';

describe('ChangesEditor', () => {
  it('shows the new text with the deleted lines, read-only, and what is compared', () => {
    const parent = document.createElement('div');
    const editor = new ChangesEditor(parent, 'intro.typ', []);
    editor.show('= Intro\n\nOld line.\n', '= Intro\n\nNew line.\n', 'c1 → c2 · Ann');
    expect(parent.querySelector('.zwf-changes-editor__title')!.textContent).toBe('intro.typ');
    expect(parent.querySelector('.zwf-changes-editor__detail')!.textContent).toBe('c1 → c2 · Ann');
    expect(parent.querySelector('.cm-content')!.textContent).toContain('New line.');
    expect(parent.querySelector('.cm-deletedChunk')!.textContent).toContain('Old line.');
    expect(parent.querySelector('.cm-content')!.getAttribute('contenteditable')).toBe('false');

    editor.show('same\n', 'same\n', 'Since last commit');
    expect(parent.querySelector('.zwf-changes-editor__detail')!.textContent).toBe('Since last commit · no changes');
    editor.showNote('Loading…');
    expect(parent.querySelector<HTMLElement>('.cm-editor')!.hidden).toBe(true);
    editor.dispose();
    expect(parent.children).toHaveLength(0);
  });
});
