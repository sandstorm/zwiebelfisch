// @vitest-environment jsdom
// Tests for codeColors (source-editor.ts, code-colors.ts).
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { highlightStyle } from './code-colors';
import { codeColors } from './source-editor';

/** Lets the color check run (it waits a microtask: no dispatch while the view is being built). */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function mount(color: string): EditorView {
  const parent = document.body.appendChild(document.createElement('div'));
  parent.style.color = color;
  return new EditorView({ parent, doc: '= Title', extensions: codeColors });
}

describe('codeColors', () => {
  it("turns on CodeMirror's dark theme where the text around the editor is light", async () => {
    const view = mount('rgb(230, 237, 243)');
    await settle();
    expect(view.state.facet(EditorView.darkTheme)).toBe(true);
    view.destroy();
  });

  it('keeps the light theme where the text is dark', async () => {
    const view = mount('rgb(31, 35, 40)');
    await settle();
    expect(view.state.facet(EditorView.darkTheme)).toBe(false);
    view.destroy();
  });

  it('colors the syntax from the widget tokens, with the light colors as fallback', () => {
    const rules = highlightStyle.module!.getRules();
    expect(rules).toContain('var(--zwf-syn-keyword, #708)');
    expect(rules).toContain('var(--zwf-syn-comment, #940)');
  });
});
