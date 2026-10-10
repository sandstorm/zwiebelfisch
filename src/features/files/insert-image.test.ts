import { describe, expect, it } from 'vitest';
import { insertImage } from './insert-image';

function apply(text: string, offset: number) {
  const change = insertImage(text, offset, 'logo.png');
  return text.slice(0, change.from) + change.insert + text.slice(change.to);
}

describe('insertImage', () => {
  it('adds the image as a paragraph of its own after the line of the cursor', () => {
    expect(apply('First line\nsame paragraph\n\nNext', 3)).toBe('First line\n\n#image("logo.png")\n\nsame paragraph\n\nNext');
    expect(apply('One\n\nTwo', 1)).toBe('One\n\n#image("logo.png")\n\nTwo');
  });

  it('appends to the end with a blank line in between', () => {
    expect(apply('Text', 4)).toBe('Text\n\n#image("logo.png")\n');
    expect(apply('Text\n', 5)).toBe('Text\n\n#image("logo.png")\n');
    expect(apply('Text\n', 2)).toBe('Text\n\n#image("logo.png")\n');
  });

  it('fills an empty document', () => {
    expect(apply('', 0)).toBe('#image("logo.png")\n');
  });

  it('escapes quotes and backslashes in the path', () => {
    expect(insertImage('', 0, 'a"b\\c.png').insert).toBe('#image("a\\"b\\\\c.png")\n');
  });
});
