// Tests for png.ts: the diagram survives the round trip through a PNG.
import { describe, expect, it } from 'vitest';
import { EMPTY_DIAGRAM_XML, emptyDiagram, fromDataUri, isPng, readDiagramXml, toDataUri, writeDiagramXml } from './png';

const XML = '<mxfile><diagram name="Seite 1">äöü → <mxGraphModel/></diagram></mxfile>';

describe('the diagram in a PNG', () => {
  it('is an empty diagram in a valid PNG for a new file', () => {
    const png = emptyDiagram();
    expect(isPng(png)).toBe(true);
    expect(readDiagramXml(png)).toBe(EMPTY_DIAGRAM_XML);
  });

  it('round-trips through writing and reading, replacing the diagram it held, keeping the picture', () => {
    const png = writeDiagramXml(emptyDiagram(), XML);
    expect(readDiagramXml(png)).toBe(XML);
    expect(png.subarray(0, 33)).toEqual(emptyDiagram().subarray(0, 33)); // signature + IHDR
    const again = writeDiagramXml(png, '<mxfile/>');
    expect(readDiagramXml(again)).toBe('<mxfile/>');
    expect(again.length).toBeLessThan(png.length);
    // the image data (IDAT) and the end (IEND) are still there, as they were
    const tail = (bytes: Uint8Array) => [...bytes.subarray(bytes.length - 35)];
    expect(tail(again)).toEqual(tail(emptyDiagram()));
  });

  it('writes chunks with valid CRCs (as diagrams.net and Typst check them)', () => {
    const png = writeDiagramXml(emptyDiagram(), XML);
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    for (let start = 8; start < png.length; ) {
      const length = view.getUint32(start);
      const crc = view.getUint32(start + 8 + length);
      expect(crc).toBe(crc32(png.subarray(start + 4, start + 8 + length)));
      start += 12 + length;
    }
  });

  it('reads no diagram from a PNG without one, or from other bytes', () => {
    expect(readDiagramXml(fromDataUri('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=')!)).toBeNull();
    expect(readDiagramXml(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(() => writeDiagramXml(new Uint8Array([1, 2, 3]), XML)).toThrow(/Not a PNG/);
  });

  it('goes to and from data URIs', () => {
    const png = writeDiagramXml(emptyDiagram(), XML);
    const uri = toDataUri(png);
    expect(uri.startsWith('data:image/png;base64,iVBORw0KGgo')).toBe(true);
    expect(fromDataUri(uri)).toEqual(png);
    expect(fromDataUri('data:image/png,plain')).toBeNull();
  });
});

/** An independent CRC-32 (bitwise, no table). */
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
