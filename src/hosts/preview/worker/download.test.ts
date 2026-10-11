// Tests for download.ts.
import { describe, expect, it } from 'vitest';
import { downloadWasm } from './download';

/** A fetch answering with `chunks` as the body and `headers`. */
function serve(chunks: Uint8Array[], headers: Record<string, string> = {}, status = 200): typeof fetch {
  return async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(chunk);
          controller.close();
        },
      }),
      { status, headers },
    );
}

const bytes = (n: number) => new Uint8Array(n).fill(7);

describe('downloadWasm', () => {
  it('passes the bytes through as application/wasm and reports what arrived of the Content-Length', async () => {
    const reports: [number, number | null][] = [];
    const response = await downloadWasm('/e.wasm', (loaded, total) => reports.push([loaded, total]), serve([bytes(3), bytes(5)], { 'Content-Length': '8' }));
    expect(response.headers.get('Content-Type')).toBe('application/wasm');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes(8));
    expect(reports[0]).toEqual([0, 8]);
    expect(reports.at(-1)).toEqual([8, 8]);
  });

  it('reports no total for a compressed body or without a length', async () => {
    const totals: (number | null)[] = [];
    const compressed = await downloadWasm('/e.wasm', (_, total) => totals.push(total), serve([bytes(4)], { 'Content-Length': '2', 'Content-Encoding': 'gzip' }));
    await compressed.arrayBuffer();
    const unknown = await downloadWasm('/e.wasm', (_, total) => totals.push(total), serve([bytes(4)]));
    await unknown.arrayBuffer();
    expect(totals.every((total) => total === null)).toBe(true);
  });

  it('drops the total when more arrives than announced', async () => {
    const reports: [number, number | null][] = [];
    const response = await downloadWasm('/e.wasm', (loaded, total) => reports.push([loaded, total]), serve([bytes(4), bytes(4)], { 'Content-Length': '5' }));
    await response.arrayBuffer();
    expect(reports.at(-1)).toEqual([8, null]);
  });

  it('rejects with the status when the server refuses', async () => {
    await expect(downloadWasm('/e.wasm', () => {}, serve([], {}, 404))).rejects.toThrow('/e.wasm: HTTP 404');
  });
});
