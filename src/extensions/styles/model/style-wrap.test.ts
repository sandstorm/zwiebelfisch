// Tests for style-wrap.ts.
import { describe, expect, it } from 'vitest';
import { SourceRange, TypstDocument } from '../../../core/typst-document/typst-document';
import { calculateStyleWrap } from './style-wrap';

function wrap(text: string, from: number, to: number, shift = 0) {
  const document = new TypstDocument(text);
  const { changes, content } = calculateStyleWrap('key', SourceRange.of({ from, to }), shift);
  document.change(changes, 'test');
  return { text: document.text, content: [content.from, content.to] };
}

describe('calculateStyleWrap', () => {
  it('puts the range into a call of the style, and says where the text is then', () => {
    expect(wrap('Press Enter now.', 6, 11)).toEqual({ text: 'Press #key[Enter] now.', content: [11, 16] });
  });

  it('makes an empty call at a caret, and counts what other changes add before it', () => {
    expect(wrap('Press now.', 6, 6, 3)).toEqual({ text: 'Press #key[]now.', content: [14, 14] });
  });
});
