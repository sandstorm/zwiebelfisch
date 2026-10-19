// Tests that the engine compiles checklists with the cheq package (./fixtures/cheq-0.4.0), as task lists need it.
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { type FontInfo, type TypstEngine, createEngine } from '../../../core/typst-engine/typst-engine';
import { withPackages } from '../../../core/typst-packages/typst-packages';
import { SourceRange } from '../../../core/typst-document/typst-document';

/**
 * The Visual editor's task lists rely on the Universe package cheq (pinned at
 * the version `checklist-preamble.ts` imports): `- [ ] ..` / `- [x] ..` items
 * must compile and draw checkboxes instead of the bracket characters.
 */
const engineDir = new URL('../../../core/typst-engine/', import.meta.url);
const wasm = readFileSync(new URL('wasm.gen/typst_engine_bg.wasm', engineDir));
const fontDir = new URL('fonts.gen/', engineDir);
const fontIndex: Record<string, FontInfo[]> = JSON.parse(readFileSync(new URL('index.json', fontDir), 'utf8'));

/** An engine with the default fonts, each loaded when a compile first uses it. */
async function engineWithFonts(): Promise<TypstEngine> {
  const engine = await createEngine(wasm);
  for (const [name, faces] of Object.entries(fontIndex)) {
    engine.addLazyFont({ name, faces, load: () => new Uint8Array(readFileSync(new URL(name, fontDir))) });
  }
  return engine;
}
const cheq = new Uint8Array(readFileSync(new URL('./fixtures/cheq-0.4.0.tar.gz', import.meta.url)));

const PREAMBLE = '#import "@preview/cheq:0.4.0": checklist\n#show: checklist\n\n';
const LIST = '- [ ] todo\n- [x] done\n';

describe('cheq checklists', () => {
  let engine: TypstEngine;
  beforeAll(async () => {
    engine = await engineWithFonts();
  });

  /** Compiles `source` and returns the boxes drawn for its `[ ]` box. */
  async function boxDrawn(source: string) {
    engine.setSource('/main.typ', source);
    const { diagnostics, pages } = await withPackages(engine, async () => cheq).compile('/main.typ');
    expect(diagnostics).toEqual([]);
    expect(pages).toHaveLength(1);
    const from = source.indexOf('[ ]');
    return engine.boxesForRanges('/main.typ', [SourceRange.of({ from: from, to: from + 3 })]);
  }

  it('compiles task items under the show rule without the brackets as text', async () => {
    expect(await boxDrawn(PREAMBLE + LIST)).toEqual([]);
  });

  it('without the show rule, the brackets are drawn as text', async () => {
    expect((await boxDrawn(LIST)).length).toBeGreaterThan(0);
  });
});
