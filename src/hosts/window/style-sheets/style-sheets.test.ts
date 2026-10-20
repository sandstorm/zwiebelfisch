// @vitest-environment jsdom
// Tests for style-sheets.ts.
import { describe, expect, it } from 'vitest';
import { StyleSheets } from './style-sheets';

const styles = (root: ParentNode) => [...root.querySelectorAll('style')].map((style) => style.textContent);

describe('StyleSheets', () => {
  it("adds a stylesheet to the document's head, and removes it when disposed", () => {
    const host = document.body.appendChild(document.createElement('div'));
    const added = new StyleSheets(host).add('.a { color: red; }', 'a-styles');
    expect(document.head.querySelector('#a-styles')?.textContent).toBe('.a { color: red; }');
    added.dispose();
    expect(document.head.querySelector('#a-styles')).toBeNull();
  });

  it('adds it to the shadow root the host lives in, not the head', () => {
    const shadow = document.body.appendChild(document.createElement('div')).attachShadow({ mode: 'open' });
    const host = shadow.appendChild(document.createElement('div'));
    new StyleSheets(host).add('.b { color: blue; }');
    expect(styles(shadow)).toEqual(['.b { color: blue; }']);
    expect(styles(document.head)).not.toContain('.b { color: blue; }');
  });

  it('shares one <style> between widgets in the same root until the last one lets go', () => {
    const one = new StyleSheets(document.body.appendChild(document.createElement('div')));
    const two = new StyleSheets(document.body.appendChild(document.createElement('div')));
    const first = one.add('.c { color: green; }');
    const second = two.add('.c { color: green; }');
    expect(styles(document.head).filter((css) => css === '.c { color: green; }')).toHaveLength(1);
    first.dispose();
    expect(styles(document.head)).toContain('.c { color: green; }');
    second.dispose();
    expect(styles(document.head)).not.toContain('.c { color: green; }');
  });
});
