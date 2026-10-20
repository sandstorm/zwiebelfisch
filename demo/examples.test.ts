// Tests that every demo example compiles without errors (examples.ts, against the built wasm), with the packages
// they import from .cache/typst-packages (mise run build:packages).
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { type FontInfo, type TypstEngine, createEngine } from '../src/core/typst-engine/typst-engine';
import { withPackages } from '../src/core/typst-packages/typst-packages';
import { neighbours } from '../src/core/typst-syntax/typst-syntax';
import { ProjectPath } from '../src/core/paths/paths';
import { Disposable } from '../src/core/disposable/disposable';
import type { ExtensionContext, PreviewViewOption, ProjectFiles } from '../src';
import { previewGuides } from '../src/extensions/preview-guides/preview-guides';
import { comments } from '../src/extensions/comments/comments';
import { Project } from '../src/core/project/project';
import { EXAMPLES, exampleFiles, exampleFromQuery, exampleQuery } from './examples';

const engineDir = new URL('../src/core/typst-engine/', import.meta.url);
const wasm = readFileSync(new URL('wasm.gen/typst_engine_bg.wasm', engineDir));
const fontDir = new URL('fonts.gen/', engineDir);
const fontIndex: Record<string, FontInfo[]> = JSON.parse(readFileSync(new URL('index.json', fontDir), 'utf8'));

/** An engine with the default fonts, each loaded when a compile first uses it; `loaded` lists the files loaded. */
async function engineWithFonts(loaded: string[] = []): Promise<TypstEngine> {
  const engine = await createEngine(wasm);
  for (const [name, faces] of Object.entries(fontIndex)) {
    engine.addLazyFont({ name, faces, load: () => (loaded.push(name), new Uint8Array(readFileSync(new URL(name, fontDir)))) });
  }
  return engine;
}

const packageDir = new URL('../.cache/typst-packages/', import.meta.url);

/** `@preview/name:1.0.0` from the downloads of `mise run build:packages`, as the demo would fetch it. */
async function cachedPackage(spec: string): Promise<Uint8Array> {
  const [, name, version] = /^@preview\/(.+):(.+)$/.exec(spec)!;
  return new Uint8Array(readFileSync(new URL(`${name}-${version}.tar.gz`, packageDir)));
}

describe('demo examples', () => {
  let engine: TypstEngine;
  let loaded: string[] = [];
  beforeAll(async () => {
    engine = await engineWithFonts();
  });

  /** Gives the engine a project on its own: the files of earlier projects are removed first. */
  function load(files: ProjectFiles) {
    loaded.forEach((path) => engine.remove(path));
    loaded = Object.keys(files);
    for (const [path, content] of Object.entries(files)) {
      if (typeof content === 'string') engine.setSource(path, content);
      else engine.setBinary(path, content);
    }
    return withPackages(engine, cachedPackage);
  }

  /** Compiles a project on its own (from `main`). */
  function compile(files: ProjectFiles, main = '/main.typ') {
    return load(files).compile(main);
  }

  // the docs draw seven Mermaid diagrams (merman's wasm): seconds, more under a parallel test run
  it.each(EXAMPLES.map(({ name }) => name))(
    '%s compiles without errors or warnings',
    async (name) => {
      const { pages, diagnostics } = await compile(exampleFiles(name));
      expect(diagnostics).toEqual([]);
      expect(pages.length).toBeGreaterThan(0);
    },
    30_000,
  );

  it.each(EXAMPLES.map(({ name }) => name))(
    '%s compiles with the preview\'s page guides, drawn on every page',
    async (name) => {
      const options: PreviewViewOption[] = [];
      const preview = { registerViewOption: (option: PreviewViewOption) => (options.push(option), new Disposable(() => {})) };
      previewGuides().activate({ preview, subscriptions: [] } as unknown as ExtensionContext);
      const guides = options.find(({ id }) => id === 'previewGuides.pageGuides')!;
      const { prelude } = guides.apply({ output: 'pages', prelude: [] }, true);
      const files = { ...exampleFiles(name), '/view.typ': `${prelude.join('\n')}\n#include "/main.typ"\n` };
      const { pages, diagnostics } = await compile(files, '/view.typ');
      expect(diagnostics).toEqual([]);
      expect(pages.length).toBeGreaterThan(0);
      for (const page of pages) expect(page.svg).toContain('#3b82f6');
    },
    30_000,
  );

  it('the simple example, with its margin note, compiles to HTML in the preview without errors: the comments leave the note out', async () => {
    const files = exampleFiles('simple');
    const options: PreviewViewOption[] = [];
    const preview = { registerViewOption: (option: PreviewViewOption) => (options.push(option), new Disposable(() => {})) };
    // what else the extension registers (the Visual editor's, the workbench's) is not looked at
    const ignored: object = new Proxy(() => ignored, { get: (_, key) => (key === 'then' ? undefined : ignored) });
    const context = new Proxy({ preview: { ...preview, registerPdfExportOption: ignored }, project: new Project(ProjectPath.of('/main.typ'), files), subscriptions: [] }, {
      get: (target, key) => (key in target ? target[key as keyof typeof target] : ignored),
    });
    comments().activate(context as unknown as ExtensionContext);
    const show = options.find(({ id }) => id === 'comments.show')!;
    const { prelude } = show.apply({ output: 'html', prelude: [] }, true);
    const view = { ...files, '/view.typ': `${prelude.join('\n')}\n#include "/main.typ"\n` };
    const { files: html, diagnostics } = await load(view).compileHtml('/view.typ');
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(html.map((file) => file.path)).toContain('index.html');
    // a range note: its text stays, the thread goes
    const [, noted, thread] = /#margin-note\[([^\]]+)\]\[([^\]]+)\]/.exec(files['/main.typ'] as string)!;
    const index = new TextDecoder().decode(html.find((file) => file.path === 'index.html')!.data);
    expect(index).toContain(noted);
    expect(index).not.toContain(thread.split(': ')[1].split('\n')[0]);
  }, 30_000);

  it('keeps the default document the e2e specs expect', () => {
    const files = exampleFiles('simple');
    expect(Object.keys(files).sort()).toEqual([
      '/data/budget.ic',
      '/data/budget.ic.gen.typ',
      '/diagrams/editor.drawio.png',
      '/diagrams/workflow.mmd',
      '/main.typ',
      '/styles.typ',
    ]);
    const main = files['/main.typ'] as string;
    // the drafting import on top (a comment's import is not repeated), room for notes on the right, one long page
    expect(main).toMatch(/^#import "@preview\/drafting:0\.2\.2": margin-note\n#set page\(width: 16cm, height: auto, margin: \(right: 4cm, rest: 1\.5cm\)\)\n/);
    expect(main.match(/^= .*$/gm)).toEqual(['= Typst in five minutes']);
    expect(main).not.toContain('#pagebreak');
    expect(main.match(/#margin-note\[/g)).toHaveLength(1);
  });

  it('the simple example shows a spreadsheet, a Mermaid and a draw.io diagram and custom styles', () => {
    const files = exampleFiles('simple');
    // the diagram's XML in the PNG's tEXt chunk `mxfile`, URI-encoded, as diagrams.net writes it
    const png = Buffer.from(files['/diagrams/editor.drawio.png'] as Uint8Array).toString('latin1');
    expect(png).toContain(`tEXtmxfile\0${encodeURIComponent('<mxfile>')}`);
    expect(png).toContain(encodeURIComponent('value="Typst source"'));
    expect(files['/data/budget.ic.gen.typ']).toMatch(/^\/\/ Generated from budget\.ic/);
    expect(files['/styles.typ']).toMatch(/\/\/\/ @style block Tip\n/);
    expect(files['/styles.typ']).toMatch(/\/\/\/ @style inline Key\n/);
  });

  it('the default document loads only the fonts it uses: the first render downloads 5 of 17 font files', async () => {
    const loaded: string[] = [];
    const fresh = await engineWithFonts(loaded);
    for (const [path, content] of Object.entries(exampleFiles('simple'))) {
      if (typeof content === 'string') fresh.setSource(path, content);
      else fresh.setBinary(path, content);
    }
    expect((await withPackages(fresh, cachedPackage).compile('/main.typ')).diagnostics).toEqual([]);
    // 2.7 MB (1.9 MB gzipped) instead of all 9.7 MB (6.4 MB gzipped)
    expect(loaded.sort()).toEqual([
      'DejaVuSansMono.ttf',
      'LibertinusSerif-Bold.otf',
      'LibertinusSerif-Italic.otf',
      'LibertinusSerif-Regular.otf',
      'NewCMMath-Book.otf',
    ]);
  });

  it('the advanced example has a template, chapters and an SVG image given as bytes', async () => {
    const files = exampleFiles('advanced');
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining(['/main.typ', '/template.typ', '/chapters/introduction.typ']),
    );
    const svgs = Object.entries(files).filter(([path]) => path.endsWith('.svg'));
    expect(svgs.length).toBeGreaterThan(0);
    for (const [, content] of svgs) expect(content).toBeInstanceOf(Uint8Array);
    expect((await compile(files)).pages.length).toBeGreaterThan(1);
  });

  it('the advanced example has an IronCalc spreadsheet, byte for byte, and its Typst file', () => {
    const files = exampleFiles('advanced');
    const onDisk = readFileSync(new URL('examples/advanced/data/compile-times.ic', import.meta.url));
    expect(files['/data/compile-times.ic']).toEqual(new Uint8Array(onDisk));
    expect(files['/data/compile-times.ic.gen.typ']).toMatch(/^\/\/ Generated from compile-times\.ic/);
  });

  it('the documentation example is docs/: book, template, HTML entry and chapters as text, the logo, the screenshots, the diagrams, the spreadsheets, the fonts and the hosts\' contracts as bytes', () => {
    const files = exampleFiles('docs');
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining(['/main.typ', '/template.typ', '/site.typ', '/40_architecture/07_window.typ']),
    );
    expect(files['/assets/sandstorm-logo.svg']).toBeInstanceOf(Uint8Array);
    expect(files['/diagrams/keystroke.mmd']).toBeInstanceOf(Uint8Array);
    expect(files['/data/runs.ic']).toBeInstanceOf(Uint8Array);
    expect(files['/src/hosts/commands/commands.ts']).toEqual(new Uint8Array(readFileSync(new URL('../src/hosts/commands/commands.ts', import.meta.url))));
    expect(Object.keys(files).filter((path) => /^\/src\/.*(\.test|-impl|-helpers)\.ts$/.test(path))).toEqual([]);
    for (const [path, content] of Object.entries(files)) {
      if (path.endsWith('.typ')) expect(typeof content).toBe('string');
      else expect(path).toMatch(/\.(svg|png|mmd|ttf|ic|css)$|^\/src\/hosts\/[\w-]+\/[\w-]+\.ts$/);
    }
  });

  it("the documentation's HTML entry, site.typ, is the docs site in the HTML preview: a page per chapter, its style sheet and logo", async () => {
    const { files, diagnostics } = await load(exampleFiles('docs')).compileHtml('/site.typ');
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const paths = files.map((file) => file.path);
    expect(paths).toEqual(expect.arrayContaining(['index.html', '40_architecture/06_preview.html', 'style.css', 'assets/sandstorm-logo.svg']));
    expect(files.filter((file) => file.document).length).toBeGreaterThan(10);
  }, 60_000);

  it('the documentation example sets its text in its own font, Gabarito, given as project files', async () => {
    const files = exampleFiles('docs');
    const fonts = Object.keys(files).filter((path) => path.endsWith('.ttf'));
    expect(fonts.sort()).toEqual(['/fonts/Gabarito-Bold.ttf', '/fonts/Gabarito-Regular.ttf', '/fonts/Gabarito-SemiBold.ttf']);
    const onDisk = readFileSync(new URL('../docs/fonts/Gabarito-Regular.ttf', import.meta.url));
    expect(files['/fonts/Gabarito-Regular.ttf']).toEqual(new Uint8Array(onDisk));
    expect(files['/template.typ']).toMatch(/#let font = "Gabarito"/);
    // without them, Typst would not know the family the template sets
    const withoutFonts = Object.fromEntries(Object.entries(files).filter(([path]) => !fonts.includes(path)));
    expect((await compile(withoutFonts)).diagnostics).toContainEqual(
      expect.objectContaining({ severity: 'warning', message: expect.stringContaining('unknown font family: gabarito') }),
    );
  }, 30_000);

  it('the documentation reads in the order of its numbered files: main.typ includes every chapter, previous / next follow', () => {
    const files = exampleFiles('docs');
    const chapters = Object.keys(files)
      .filter((path) => /^\/\d+_[\w-]+\/\d+_[\w-]+\.typ$/.test(path))
      .sort()
      .map(ProjectPath.of);
    expect(chapters.length).toBeGreaterThan(10);
    const read = (path: string) => (typeof files[path] === 'string' ? (files[path] as string) : undefined);
    const main = ProjectPath.of('/main.typ');
    chapters.forEach((chapter, i) => {
      expect(neighbours(read, main, chapter)).toEqual({ previous: chapters[i - 1] ?? main, next: chapters[i + 1] ?? null });
    });
  });
});

describe('exampleFromQuery', () => {
  it.each([
    ['', 'simple'],
    ['?example=simple', 'simple'],
    ['?example=advanced&room=r&user=u', 'advanced'],
    ['?example=docs', 'docs'],
    ['?example=nope', 'simple'],
  ])('"%s" → %s', (query, name) => {
    expect(exampleFromQuery(new URLSearchParams(query))).toBe(name);
  });
});

describe('exampleQuery', () => {
  it('keeps room and user and replaces the example', () => {
    const query = exampleQuery('simple', new URLSearchParams('?example=advanced&room=r1&user=Ada'));
    expect(new URLSearchParams(query).toString()).toBe('example=simple&room=r1&user=Ada');
  });
});
