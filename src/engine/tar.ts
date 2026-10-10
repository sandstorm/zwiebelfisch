const BLOCK = 512;

/**
 * Unpacks a gzipped tar archive (ustar, pax or GNU long names) into
 * path → contents. Only regular files are returned; paths are relative,
 * without a leading `./`. Rejects if the data is not gzip.
 */
export async function untarGz(data: Uint8Array): Promise<Map<string, Uint8Array>> {
  return untar(await gunzip(data));
}

async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function untar(tar: Uint8Array): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  /** A name for the next entry, from a pax or GNU long-name header. */
  let longName: string | null = null;
  for (let offset = 0; offset + BLOCK <= tar.length; ) {
    const header = tar.subarray(offset, offset + BLOCK);
    if (header.every((byte) => byte === 0)) break;
    const size = parseInt(field(header, 124, 12).trim() || '0', 8);
    const body = tar.subarray(offset + BLOCK, offset + BLOCK + size);
    offset += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
    const type = String.fromCharCode(header[156]);
    if (type === 'L') longName = decode(body).replace(/\0.*$/s, '');
    else if (type === 'x') longName = paxPath(decode(body)) ?? longName;
    else if (type === '0' || type === '\0') {
      const name = normalize(longName ?? headerName(header));
      if (name) files.set(name, body);
    }
    if (type !== 'L' && type !== 'x') longName = null;
  }
  return files;
}

/** ustar splits long names into `prefix/name`. */
function headerName(header: Uint8Array): string {
  const name = field(header, 0, 100);
  const prefix = field(header, 257, 6) === 'ustar' ? field(header, 345, 155) : '';
  return prefix ? `${prefix}/${name}` : name;
}

/** The `path` record of a pax extended header (`<length> path=<value>\n`). */
function paxPath(records: string): string | undefined {
  return /(?:^|\n)\d+ path=([^\n]*)\n/.exec(records)?.[1];
}

function normalize(name: string): string {
  return name.replace(/^(\.\/)+/, '').replace(/^\/+/, '');
}

function field(header: Uint8Array, start: number, length: number): string {
  return decode(header.subarray(start, start + length)).replace(/\0.*$/s, '');
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}
