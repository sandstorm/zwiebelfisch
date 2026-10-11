// The diagram inside a `.drawio.png`. See ../diagrams.ts.

/**
 * The diagram's XML stored in the PNG `png`, or null when it holds none (or is no PNG).
 *
 * Diagrams.net stores the diagram's XML in a `tEXt` chunk named `mxfile` (URI-encoded), so the file is an ordinary PNG
 * for Typst and an editable diagram for diagrams.net. Reading and writing that chunk, PNGs as data URIs (how the
 * embedded editor takes and gives them), and the empty diagram "New diagram…" writes.
 */
export function readDiagramXml(png: Uint8Array): string | null {
  for (const chunk of chunks(png)) {
    if (chunk.type !== 'tEXt') continue;
    const text = latin1(chunk.data);
    const separator = text.indexOf('\0');
    if (!KEYWORDS.includes(text.slice(0, separator))) continue;
    try {
      return decodeURIComponent(text.slice(separator + 1));
    } catch {
      return null;
    }
  }
  return null;
}

/** Whether `bytes` start like a PNG. */
export function isPng(bytes: Uint8Array): boolean {
  return SIGNATURE.every((byte, i) => bytes[i] === byte);
}

/** `png` with `xml` as its diagram: any diagram it held is replaced; the picture stays as it is. */
export function writeDiagramXml(png: Uint8Array, xml: string): Uint8Array {
  const all = chunks(png);
  const header = all.find((chunk) => chunk.type === 'IHDR');
  if (!header) throw new Error('Not a PNG');
  const kept = all.filter((chunk) => !(chunk.type === 'tEXt' && KEYWORDS.some((keyword) => startsWithKeyword(chunk.data, keyword))));
  const text = encodeChunk('tEXt', ascii(`mxfile\0${encodeURIComponent(xml)}`));
  const parts = [png.subarray(0, header.start), ...kept.flatMap((chunk) => (chunk === header ? [png.subarray(chunk.start, chunk.end), text] : [png.subarray(chunk.start, chunk.end)]))];
  return concat(parts);
}

/** `png` as a `data:image/png;base64,…` URI. */
export function toDataUri(png: Uint8Array): string {
  return `data:image/png;base64,${btoa(latin1(png))}`;
}

/** The bytes of a base64 data URI (`data:image/png;base64,…`); null for anything else. */
export function fromDataUri(uri: string): Uint8Array | null {
  const match = /^data:[^;,]*;base64,(.*)$/s.exec(uri);
  if (!match) return null;
  const binary = atob(match[1]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** The chunks of `png` in order (none when it is no PNG; a truncated one ends the list). */
function chunks(png: Uint8Array): Chunk[] {
  if (!isPng(png)) return [];
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const result: Chunk[] = [];
  for (let start = SIGNATURE.length; start + 12 <= png.length; ) {
    const length = view.getUint32(start);
    const end = start + 12 + length;
    if (end > png.length) break;
    result.push({ type: latin1(png.subarray(start + 4, start + 8)), data: png.subarray(start + 8, start + 8 + length), start, end });
    start = end;
  }
  return result;
}

/** One chunk of a PNG: its type, its data, and where it starts and ends in the file. */
interface Chunk {
  readonly type: string;
  readonly data: Uint8Array;
  readonly start: number;
  readonly end: number;
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** The bytes as characters (a big diagram's chunk goes in slices: arguments are limited). */
function latin1(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return text;
}

/** The keyword of the chunk holding the diagram (diagrams.net also reads `mxGraphModel`). */
const KEYWORDS = ['mxfile', 'mxGraphModel'];

function startsWithKeyword(data: Uint8Array, keyword: string): boolean {
  return latin1(data.subarray(0, keyword.length + 1)) === `${keyword}\0`;
}

/** A chunk with its length and CRC. */
function encodeChunk(type: string, data: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(12 + data.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, data.length);
  bytes.set(ascii(type), 4);
  bytes.set(data, 8);
  view.setUint32(8 + data.length, crc32(bytes.subarray(4, 8 + data.length)));
  return bytes;
}

function ascii(text: string): Uint8Array {
  return Uint8Array.from(text, (char) => char.charCodeAt(0));
}

/** The CRC-32 PNG chunks carry (over type and data). */
function crc32(bytes: Uint8Array): number {
  crcTable ??= Uint32Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

let crcTable: Uint32Array | null = null;

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

// --- The empty diagram: a valid PNG (one transparent pixel, so Typst shows nothing yet) with an empty diagrams.net
// diagram in it

/** A diagram with one empty page, as diagrams.net writes it. */
export const EMPTY_DIAGRAM_XML =
  '<mxfile><diagram id="page-1" name="Page-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>';

/** The bytes of a new, empty `.drawio.png`. */
export function emptyDiagram(): Uint8Array {
  return writeDiagramXml(fromDataUri(BLANK_PNG)!, EMPTY_DIAGRAM_XML);
}

/** A 1×1 transparent PNG. */
const BLANK_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=';
