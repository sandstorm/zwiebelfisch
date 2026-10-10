import { readFileSync, readdirSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { createEngine, type Engine } from './typst-engine';
import { withPackages } from './packages/packages';

/**
 * The Visual view's task lists rely on the Universe package cheq (pinned at
 * the version `checklist-preamble.ts` imports): `- [ ] ..` / `- [x] ..` items
 * must compile and draw checkboxes instead of the bracket characters.
 */
const wasm = readFileSync(new URL('./wasm/typst_engine_bg.wasm', import.meta.url));
const fontDir = new URL('./fonts/', import.meta.url);
const fonts = readdirSync(fontDir).map((name) => new Uint8Array(readFileSync(new URL(name, fontDir))));
const cheq = new Uint8Array(readFileSync(new URL('./fixtures/cheq-0.4.0.tar.gz', import.meta.url)));

const PREAMBLE = '#import "@preview/cheq:0.4.0": checklist\n#show: checklist\n\n';
const LIST = '- [ ] todo\n- [x] done\n';

describe('cheq checklists', () => {
  let engine: Engine;
  beforeAll(async () => {
    engine = await createEngine(wasm, fonts);
  });

  /** Compiles `source` and returns the boxes drawn for its `[ ]` box. */
  async function boxDrawn(source: string) {
    engine.setSource('/main.typ', source);
    const { diagnostics, pages } = await withPackages(engine, async () => cheq).compile('/main.typ');
    expect(diagnostics).toEqual([]);
    expect(pages).toHaveLength(1);
    const from = source.indexOf('[ ]');
    return engine.boxesForRanges('/main.typ', [{ from, to: from + 3 }]);
  }

  it('compiles task items under the show rule without the brackets as text', async () => {
    expect(await boxDrawn(PREAMBLE + LIST)).toEqual([]);
  });

  it('without the show rule, the brackets are drawn as text', async () => {
    expect((await boxDrawn(LIST)).length).toBeGreaterThan(0);
  });
});
