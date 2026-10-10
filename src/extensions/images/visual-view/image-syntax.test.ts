// Tests for image-syntax.ts and figures.ts: an image call's path, a new call, and what a figure has besides its parts.
import { describe, expect, it } from 'vitest';
import { PathReference } from '../../../core/paths/paths';
import { print } from '../../../hosts/projection/projection';
import { edit, expectPreciseMap, project, schema } from '../../../testing/testing';
import { hasFigureExtras } from './figures';
import { imagePath, imageSource } from './image-syntax';

describe('image calls', () => {
  it('prints an image created in the editor', () => {
    const doc = edit(project('Text\n'), (s) =>
      s.tr.insert(s.doc.content.size, schema.nodes.image.create({ src: imageSource(PathReference.of('a "b".png')) })),
    );
    expect(print(doc)).toBe('Text\n\n#image("a \\"b\\".png")\n');
    expectPreciseMap(doc);
  });

  it('reads the path of an image source', () => {
    expect(imagePath('#image("img/a.png", width: 50%)')).toBe('img/a.png');
    expect(imagePath('#image("a\\"b.png")')).toBe('a"b.png');
    expect(imagePath('#image(x)')).toBeNull();
  });

  it('reads the image path of a figure body', () => {
    expect(imagePath('image("img/a.png", width: 50%)')).toBe('img/a.png');
  });
});

describe('figures', () => {
  it('tells whether a figure has more than its image and caption', () => {
    const extras = (text: string) => hasFigureExtras(project(text).child(0));
    expect(extras('#figure(image("a.png"), caption: [x])')).toBe(false);
    expect(extras('#figure(\n  image("a.png"),\n  caption: [x],\n)')).toBe(false);
    expect(extras('#figure(image("a.png"), caption: [x]) <a>')).toBe(true);
    expect(extras('#figure(image("a.png"), placement: top)')).toBe(true);
  });
});
