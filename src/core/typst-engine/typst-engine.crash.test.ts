// Tests for createEngine (typst-engine.ts), against the built wasm: what a crash leaves, and the memory a long edit
// session takes. A file of its own: a crash breaks the wasm instance of every engine of the file.
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { type FontInfo, TypstEngineCrash, createEngine } from './typst-engine';
import init from './wasm/typst_engine';

const wasm = readFileSync(new URL('./wasm/typst_engine_bg.wasm', import.meta.url));
const fontDir = new URL('./fonts/', import.meta.url);
const fontIndex: Record<string, FontInfo[]> = JSON.parse(readFileSync(new URL('index.json', fontDir), 'utf8'));

it('keeps its memory while a document is edited and compiled again and again', async () => {
  const engine = await createEngine(wasm);
  for (const [name, faces] of Object.entries(fontIndex)) engine.addLazyFont({ name, faces, load: () => new Uint8Array(readFileSync(new URL(name, fontDir))) });
  const { memory } = await init({ module_or_path: wasm });
  const paragraphs = Array.from({ length: 200 }, (_, i) => `== Section ${i}\nSome text about $x_${i}^2$ and *more* _words_ #lorem(40)`);
  const compile = (edit: number) => {
    engine.setSource('/main.typ', paragraphs.map((text, i) => (i === edit % paragraphs.length ? `${text} edit ${edit}` : text)).join('\n\n'));
    expect(engine.compile('/main.typ').diagnostics).toEqual([]);
  };
  for (let edit = 0; edit < 20; edit++) compile(edit);
  const before = memory.buffer.byteLength;
  for (let edit = 20; edit < 220; edit++) compile(edit);
  // Typst's memoized results of edits long gone are dropped (without, it grew by about 1.5 GB here)
  expect((memory.buffer.byteLength - before) / 1e6).toBeLessThan(100);
}, 120_000);

it('throws the panic of a crash on that call and every later one', async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  const engine = await createEngine(wasm);
  engine.setSource('/main.typ', 'Fine');
  expect(engine.compile('/main.typ').pages).toHaveLength(1);

  // a vector too long for a 32-bit address space: Typst panics
  engine.setSource('/main.typ', '#range(200000000).len()');
  const message = /^capacity overflow \(at ecow-[\d.]+\/src\/vec\.rs:\d+\)$/;
  expect(() => engine.compile('/main.typ')).toThrow(TypstEngineCrash);
  expect(() => engine.compile('/main.typ')).toThrow(message);
  expect(() => engine.setSource('/main.typ', 'Fine')).toThrow(message);
  // every engine of the instance
  await expect(createEngine(wasm)).rejects.toThrow(message);
  expect(errors).toHaveBeenCalledWith(expect.stringMatching(/^The Typst compiler crashed: capacity overflow/));
});
