// @vitest-environment jsdom
// Tests for code-colors.ts.
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { codeColors, isLightText, typstHighlightStyle } from './code-colors';

/** Lets the color check run (it waits a microtask: no dispatch while the view is being built). */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function mount(color: string): EditorView {
  const parent = document.body.appendChild(document.createElement('div'));
  parent.style.color = color;
  return new EditorView({ parent, doc: '= Title', extensions: codeColors });
}

describe('isLightText', () => {
  it('tells light text (a dark background) from dark text', () => {
    expect(isLightText('rgb(230, 237, 243)')).toBe(true);
    expect(isLightText('rgb(31, 35, 40)')).toBe(false);
    expect(isLightText('rgba(255, 255, 255, 0.9)')).toBe(true);
  });

  it('knows nothing from an unresolved color', () => {
    expect(isLightText('')).toBeNull();
    expect(isLightText('light-dark(black, white)')).toBeNull();
  });
});

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
    const rules = typstHighlightStyle.module!.getRules();
    expect(rules).toContain('var(--te-syn-keyword, #708)');
    expect(rules).toContain('var(--te-syn-comment, #940)');
  });
});
