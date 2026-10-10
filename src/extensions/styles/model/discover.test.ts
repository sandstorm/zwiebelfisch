// Tests for discover.ts.
import { describe, expect, it } from 'vitest';
import { scanStyles } from './discover';

const STYLES = `/// The house styles.

/// A grey box.
/// @style paragraph Note
#let note(body) = block(fill: luma(240), inset: 8pt, radius: 4pt, body)

/// @style text Keyword
#let key(body) = text(fill: rgb("#1f4fa0"), weight: "bold", body)

/// @style paragraph Callout box
#let callout(body, kind: "info") = block(stroke: blue, body)
`;

describe('scanStyles', () => {
  it('finds the declared paragraph and text styles of a file, with their labels', () => {
    expect(scanStyles(STYLES)).toEqual([
      { name: 'note', kind: 'paragraph', label: 'Note' },
      { name: 'key', kind: 'text', label: 'Keyword' },
      { name: 'callout', kind: 'paragraph', label: 'Callout box' },
    ]);
  });

  it('labels a style by its name when the declaration has none', () => {
    expect(scanStyles('/// @style text\n#let term(body) = emph(body)\n')).toEqual([{ name: 'term', kind: 'text', label: 'term' }]);
  });

  it('ignores undeclared functions, wrong signatures, unknown kinds and declarations not right above the #let', () => {
    const text = [
      '#let plain(body) = body',
      '/// @style paragraph Two',
      '#let two(a, b) = a',
      '/// @style paragraph None',
      '#let none() = []',
      '/// @style text Spread',
      '#let spread(..args) = []',
      '/// @style table Wrong',
      '#let wrong(body) = body',
      '/// @style paragraph Far',
      '',
      '#let far(body) = body',
      '/// @style paragraph Value',
      '#let value = 1',
    ].join('\n');
    expect(scanStyles(text)).toEqual([]);
  });
});
