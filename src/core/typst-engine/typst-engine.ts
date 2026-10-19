import { ProjectPath } from '../paths/paths';
import { type SourceOffset, SourceRange } from '../typst-document/typst-document';
import init, { Engine as WasmEngine, type InitInput, onPanic } from './wasm.gen/typst_engine';

/**
 * The Typst compiler, SVG renderer, PDF and HTML export and preview hit-testing (Rust → wasm).
 *
 * The preview runs it in a worker and hands it the project's files; it keeps the last compiled document, so clicks
 * and cursors can be mapped between source and pages. Paths are project paths like `/main.typ`, or package paths like
 * `@preview/name:0.1.0/lib.typ`. Offsets are UTF-16 code units, pages are 0-based, and coordinates are points from
 * the page's top-left.
 *
 * After a panic (a bug in Typst or the engine) or running out of memory, every later call throws the
 * `TypstEngineCrash` of the first. Only a new instance (a new worker) compiles again.
 */
export interface TypstEngine {
  /** Adds all faces of an OpenType/TrueType font (or collection). Throws if `data` is no font. */
  addFont(data: Uint8Array): void;
  /**
   * Adds the faces of a font file whose data is loaded only when a compile first uses one of them (Typst's font
   * book needs every face's `FontInfo` up front, the data only for faces it lays out). Throws if `faces` is empty.
   * If the file cannot be loaded, the compile or export that needed it reports a warning, once per file.
   */
  addLazyFont(font: LazyFont): void;
  setSource(path: string, text: string): void;
  /**
   * Adds or replaces a binary file. A project font file (`.ttf`, `.otf`, `.ttc`, `.otc`, in any folder) is also a font
   * of the compile, as on typst.app, until it is removed; only the changed file's faces are read again.
   */
  setBinary(path: string, data: Uint8Array): void;
  remove(path: string): void;
  compile(main: string): CompileResult;
  /**
   * Compiles `main` and exports it as a PDF file (null if the document has
   * errors). Does not replace the document of the last `compile`, which
   * hit-testing uses, so `main` may be another entry than the preview's.
   */
  exportPdf(main: string): PdfResult;
  /**
   * Compiles `main` to HTML (Typst's bundle export: the files its `document(..)` and `asset(..)` calls make; a
   * document without `document(..)` is one `index.html`). Each element made from source is marked with
   * `HTML_ELEMENT_ATTRIBUTE`. Does not replace the document of the last `compile`; `elementsAtCursor` reads this one.
   */
  compileHtml(main: string): HtmlResult;
  /**
   * The elements of the last `compileHtml` that the cursor at `offset` produced: the first of each HTML document that
   * has one, in bundle order. Where its text also shows elsewhere (a heading's text in a table of contents), only the
   * places in an element of what encloses the cursor (the heading itself) count. Empty if it produced none (a `#let`,
   * a comment).
   */
  elementsAtCursor(path: string, offset: SourceOffset): ElementLocation[];
  /** What is at a point of the last compiled document, or null for empty space. */
  jumpFromClick(page: PageIndex, x: Pt, y: Pt): SourceJump | null;
  /**
   * Where the cursor at `offset` is shown in the last compiled document, where it is shown first: where its text is
   * drawn (one position per page), from the start of the element around it on (not a heading's entry in an outline
   * before); where that element starts if no text is drawn there (a label: the element it labels). Empty if none.
   */
  jumpFromCursor(path: string, offset: SourceOffset): Position[];
  /**
   * Where the given source ranges of `path` are drawn in the last compiled
   * document: one box per run of glyphs (per line and page) whose character
   * lies in a range, and one per shape (rule, fraction line, rectangle) or
   * image whose syntax node starts in one. Empty ranges and code that draws
   * nothing yield nothing.
   */
  boxesForRanges(path: string, ranges: readonly SourceRange[]): PageRect[];
  /**
   * The bytes of memory the wasm holds now. It grows while the engine needs more (its caches, the documents) and never
   * shrinks; at `ENGINE_MEMORY_LIMIT` the engine crashes.
   */
  readonly memoryInUse: number;
}

/** The most memory a wasm instance can hold (32-bit addresses): 4 GiB. */
export const ENGINE_MEMORY_LIMIT = 2 ** 32;

/**
 * What every call of a `TypstEngine` throws once the engine crashed (and all others of this wasm instance with it).
 * `message` says why: the panic's message and where it was raised (`capacity overflow (at ecow-0.2.6/src/vec.rs:1227)`),
 * else the error of the call and the memory in use.
 */
export class TypstEngineCrash extends Error {
  override readonly name = 'TypstEngineCrash';
}

/** A page of a compiled document, counted from 0 as the engine does; people see page numbers (`index + 1`). */
export type PageIndex = number & { readonly __type: 'PageIndex' };

export const PageIndex = {
  /** `value`, counted from 0, as a page index. */
  of(value: number): PageIndex {
    return value as PageIndex;
  },
};

/** A length in Typst points (1/72 inch), as the engine measures pages, from a page's top-left corner. */
export type Pt = number & { readonly __type: 'Pt' };

export const Pt = {
  /** `value`, in points, as a length. */
  of(value: number): Pt {
    return value as Pt;
  },
};

export interface CompileResult {
  /** Empty when compilation failed. */
  pages: Page[];
  diagnostics: TypstDiagnostic[];
  /**
   * Imported packages (`@namespace/name:version`) of which the engine has no
   * files. Add their files and compile again; `withPackages` does that.
   */
  missingPackages: string[];
}

/**
 * What a PDF compiles: an entry file and source texts that replace (or add to) the project's `.typ` files for this
 * compile only (the project itself stays as it is). `{ main, sources: {} }` is the project as it is.
 */
export interface PdfEntry {
  readonly main: string;
  /** Replaced and added `.typ` files by path; the rest of the project stays as it is. */
  readonly sources: Readonly<Record<string, string>>;
}

export interface PdfResult {
  /** The PDF file; null when compilation failed (see `diagnostics`). */
  pdf: Uint8Array | null;
  diagnostics: TypstDiagnostic[];
  /** As in `CompileResult`: add these packages and export again. */
  missingPackages: string[];
}

/** What `compileHtml` made. */
export interface HtmlResult {
  /** The bundle's files in bundle order; empty when compilation failed. */
  files: HtmlFile[];
  diagnostics: TypstDiagnostic[];
  /** As in `CompileResult`: add these packages and compile again. */
  missingPackages: string[];
}

/** A file of an HTML bundle: an HTML document, or an asset (style sheet, image, a paged document's PDF or SVG). */
export interface HtmlFile {
  /** Its path in the bundle, without leading slash: `index.html`, `chapters/intro.html`, `style.css`. */
  path: string;
  /** Changes if and only if `data` changes. */
  hash: string;
  /** Whether it is an HTML document (one the preview can show). */
  document: boolean;
  data: Uint8Array;
}

/** An element of an HTML document, by `HTML_ELEMENT_ATTRIBUTE`; `element` null: the document only. */
export interface ElementLocation {
  /** The document's bundle path (`HtmlFile.path`). */
  path: string;
  element: string | null;
}

/**
 * The attribute `compileHtml` gives each element made from source: unique within its document, and the same after an
 * edit elsewhere in the source.
 */
export const HTML_ELEMENT_ATTRIBUTE = 'data-typst-element';

export interface Page {
  /** Changes if and only if the page's content changes. */
  hash: string;
  width: Pt;
  height: Pt;
  svg: string;
}

/** A compile error or warning, at `from..to` of its file. */
export interface TypstDiagnostic extends SourceRange {
  severity: 'error' | 'warning';
  message: string;
  hints: string[];
  /** The project file it is in; null when it has no location, or is in a package file. */
  path: ProjectPath | null;
}

export interface Position {
  page: PageIndex;
  x: Pt;
  y: Pt;
}

/** A rectangle on a page, from its top-left corner. */
export interface PageRect {
  page: PageIndex;
  x: Pt;
  y: Pt;
  w: Pt;
  h: Pt;
}

export type SourceJump =
  /** `from..to` is the syntax leaf containing `offset`, e.g. a text run. */
  | {
      kind: 'source';
      path: string;
      offset: SourceOffset;
      from: SourceOffset;
      to: SourceOffset;
      /** Where the clicked source node is drawn: one box per line/page; empty for non-text. */
      boxes: PageRect[];
    }
  | { kind: 'url'; url: string }
  | ({ kind: 'position' } & Position);

/**
 * One face of a font file as Typst's font book sees it: Typst's `FontInfo` (family, variant, flags, coverage), passed
 * through as the engine wrote it, plus the face's index in its file (a collection has several).
 */
export interface FontInfo {
  readonly index: number;
  readonly family: string;
}

/** A font file the engine knows the faces of, with its data loaded on first use. */
export interface LazyFont {
  /** The file's name (e.g. `NewCMMath-Book.otf`), for the warning when it cannot be loaded. */
  readonly name: string;
  /** The file's faces, as the font index lists them (`mise run build:fonts`). */
  readonly faces: readonly FontInfo[];
  /**
   * The file's data, or null if it cannot be loaded (its faces then count as absent, Typst falls back to other
   * fonts, and that compile reports a warning). Called at most once, synchronously in the middle of a compile.
   */
  load(): Uint8Array | null;
}

/**
 * Instantiates the engine from the wasm module (URL, bytes or response). The engine embeds no fonts: add them
 * with `addLazyFont` (the default fonts: `DEFAULT_FONTS`, see core/engine-assets) or `addFont`.
 */
export async function createEngine(wasm: InitInput | Promise<InitInput>): Promise<TypstEngine> {
  const { memory } = await init({ module_or_path: wasm });
  /** Calls the wasm; a call that fails crashed the instance: it and every later one throw the same `TypstEngineCrash`. */
  const call = <R>(task: () => R): R => {
    if (crash) throw crash;
    try {
      return task();
    } catch (error) {
      crash = new TypstEngineCrash(panic ?? `${String(error)} (${megabytes(memory.buffer.byteLength)} MB of memory in use)`);
      console.error(`The Typst compiler crashed: ${crash.message}`);
      throw crash;
    }
  };
  call(() => onPanic({ panicked: (message: string) => (panic = message) }));
  const engine = call(() => new WasmEngine());
  /** Lazy font files that failed to load since the last report: the next compile or export reports them. */
  let unloadedFonts: string[] = [];
  const report = <R extends { diagnostics: TypstDiagnostic[] }>(json: string): R => {
    const result = parseReport<R>(json);
    result.diagnostics.push(...unloadedFonts.map(fontWarning));
    unloadedFonts = [];
    return result;
  };
  return {
    addFont: (data) => {
      if (call(() => engine.addFont(data)) === 0) throw new Error('no font found in the given data');
    },
    addLazyFont: (font) => {
      const load = () => {
        const data = font.load();
        if (data === null) unloadedFonts.push(font.name);
        return data;
      };
      if (call(() => engine.addLazyFont(JSON.stringify(font.faces), { load })) === 0) throw new Error('a lazy font needs faces');
    },
    setSource: (path, text) => assertValidPath(call(() => engine.setSource(path, text)), path),
    setBinary: (path, data) => assertValidPath(call(() => engine.setBinary(path, data)), path),
    remove: (path) => call(() => engine.remove(path)),
    compile: (main) => report<CompileResult>(call(() => engine.compile(main))),
    exportPdf: (main) => {
      const { pdf, json } = call(() => consume(engine.exportPdf(main), (exported) => ({ pdf: exported.pdf() ?? null, json: exported.report() })));
      return { pdf, ...report<Omit<PdfResult, 'pdf'>>(json) };
    },
    compileHtml: (main) => call(() => consume(engine.compileHtml(main), (exported) => withData(report<HtmlReport>(exported.report()), exported))),
    elementsAtCursor: (path, offset) => JSON.parse(call(() => engine.elementsAtCursor(path, offset))),
    jumpFromClick: (page, x, y) => {
      const json = call(() => engine.jumpFromClick(page, x, y));
      return json === undefined ? null : JSON.parse(json);
    },
    jumpFromCursor: (path, offset) => JSON.parse(call(() => engine.jumpFromCursor(path, offset))),
    boxesForRanges: (path, ranges) =>
      JSON.parse(call(() => engine.boxesForRanges(path, new Uint32Array(ranges.flatMap(({ from, to }) => [from, to]))))),
    get memoryInUse() {
      return memory.buffer.byteLength;
    },
  };
}

/** The panic message the wasm told last; null while it never panicked. One wasm instance serves every engine. */
let panic: string | null = null;
/** What every call throws once a call failed: the instance is broken for every engine. */
let crash: TypstEngineCrash | null = null;

/** What `read` reads of a result the wasm made, which is freed then. */
function consume<T extends { free(): void }, R>(made: T, read: (made: T) => R): R {
  try {
    return read(made);
  } finally {
    made.free();
  }
}

/** The report of an HTML compile: its files without their data. */
type HtmlReport = Omit<HtmlResult, 'files'> & { files: Omit<HtmlFile, 'data'>[] };

/** The report's files with their data. */
function withData(result: HtmlReport, exported: { data(index: number): Uint8Array | undefined }): HtmlResult {
  return { ...result, files: result.files.map((file, index) => ({ ...file, data: exported.data(index) ?? new Uint8Array() })) };
}

function megabytes(bytes: number): string {
  return (bytes / 1e6).toFixed(0);
}

/** A report of the wasm (JSON) with its diagnostics' paths parsed: a package file has no project path. */
function parseReport<R extends { diagnostics: TypstDiagnostic[] }>(json: string): R {
  const report = JSON.parse(json) as R;
  for (const d of report.diagnostics) d.path = d.path === null ? null : ProjectPath.parse(d.path);
  return report;
}

/** A font file's data was not there when the layout needed it; it is not asked for again. */
function fontWarning(name: string): TypstDiagnostic {
  return {
    severity: 'warning',
    message: `Font file ${name} could not be loaded; Typst used another font.`,
    hints: [],
    path: null,
    ...SourceRange.of({ from: 0, to: 0 }),
  };
}

function assertValidPath(ok: boolean, path: string): void {
  if (!ok) throw new Error(`invalid project path: ${path}`);
}
