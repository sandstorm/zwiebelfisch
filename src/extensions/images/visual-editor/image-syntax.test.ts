// Tests for image-syntax.ts: an image call's path and a new call.
import { describe, expect, it } from 'vitest';
import { PathReference } from '../../../core/paths/paths';
import { serializeToTypst } from '../../../hosts/visual-editor/typst-conversion/typst-conversion';
import { edit, expectPreciseMap, parseTypst, schema } from '../../../testing/testing';
import { imagePath, imageSource } from './image-syntax';

describe('image calls', () => {
  it('prints an image created in the editor', () => {
    const doc = edit(parseTypst('Text\n'), (s) =>
      s.tr.insert(s.doc.content.size, schema.nodes.image.create({ src: imageSource(PathReference.of('a "b".png')) })),
    );
    expect(serializeToTypst(doc)).toBe('Text\n\n#image("a \\"b\\".png")\n');
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
