// Tests for discover.ts.
import { describe, expect, it } from 'vitest';
import { scanStyles } from './discover';

const STYLES = `/// The house styles.

/// A grey box.
/// @style block Note
#let note(body) = block(fill: luma(240), inset: 8pt, radius: 4pt, body)

/// @style inline Keyword
#let key(body) = text(fill: rgb("#1f4fa0"), weight: "bold", body)

/// @style block Callout box
#let callout(body, kind: "info") = block(stroke: blue, body)
`;

describe('scanStyles', () => {
  it('finds the declared block and inline styles of a file, with their labels', () => {
    expect(scanStyles(STYLES)).toEqual([
      { name: 'note', kind: 'block', label: 'Note' },
      { name: 'key', kind: 'inline', label: 'Keyword' },
      { name: 'callout', kind: 'block', label: 'Callout box' },
    ]);
  });

  it('labels a style by its name when the declaration has none', () => {
    expect(scanStyles('/// @style inline\n#let term(body) = emph(body)\n')).toEqual([{ name: 'term', kind: 'inline', label: 'term' }]);
  });

  it('ignores undeclared functions, wrong signatures, unknown kinds and declarations not right above the #let', () => {
    const text = [
      '#let plain(body) = body',
      '/// @style block Two',
      '#let two(a, b) = a',
      '/// @style block None',
      '#let none() = []',
      '/// @style inline Spread',
      '#let spread(..args) = []',
      '/// @style table Wrong',
      '#let wrong(body) = body',
      '/// @style block Far',
      '',
      '#let far(body) = body',
      '/// @style block Value',
      '#let value = 1',
    ].join('\n');
    expect(scanStyles(text)).toEqual([]);
  });
});
