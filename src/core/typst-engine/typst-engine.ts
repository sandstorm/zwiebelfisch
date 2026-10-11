// The typed TypeScript side of the typst-engine wasm (crates/typst-engine): createEngine and the engine's
// data types. Entry of core/typst-engine/. See docs/architecture/core.typ.
import init, { Engine as WasmEngine, type InitInput } from './wasm/typst_engine';

// Asset URLs (wasm, default fonts) are core/engine-assets, not here: the worker imports this file. Packages
// (@preview/…) are core/typst-packages.

/**
 * The Typst compiler, SVG renderer and preview hit-testing (Rust → wasm).
 *
 * Paths are project paths like `/main.typ`, or package paths like
 * `@preview/name:0.1.0/lib.typ` (see `withPackages`). Offsets are UTF-16 code units,
 * pages are 0-based, and coordinates are points from the page's top-left.
 * The engine keeps the last successfully compiled document for hit-testing.
 */
export interface Engine {
  /** Adds all faces of an OpenType/TrueType font (or collection). Throws if `data` is no font. */
  addFont(data: Uint8Array): void;
  setSource(path: string, text: string): void;
  setBinary(path: string, data: Uint8Array): void;
  remove(path: string): void;
  compile(main: string): CompileResult;
  /**
   * Compiles `main` and exports it as a PDF file (null if the document has
   * errors). Does not replace the document of the last `compile`, which
   * hit-testing uses, so `main` may be another entry than the preview's.
   */
  exportPdf(main: string): PdfResult;
  /** What is at a point of the last compiled document, or null for empty space. */
  jumpFromClick(page: number, x: number, y: number): Jump | null;
  /** Where the text at `offset` appears in the last compiled document. */
  jumpFromCursor(path: string, offset: number): Position[];
  /**
   * Where the given source ranges of `path` are drawn in the last compiled
   * document: one box per run of glyphs (per line and page) whose character
   * lies in a range, and one per shape (rule, fraction line, rectangle) or
   * image whose syntax node starts in one. Empty ranges and code that draws
   * nothing yield nothing.
   */
  boxesForRanges(path: string, ranges: readonly { from: number; to: number }[]): Box[];
}

export interface CompileResult {
  /** Empty when compilation failed. */
  pages: Page[];
  diagnostics: Diagnostic[];
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
  diagnostics: Diagnostic[];
  /** As in `CompileResult`: add these packages and export again. */
  missingPackages: string[];
}

export interface Page {
  /** Changes if and only if the page's content changes. */
  hash: string;
  width: number;
  height: number;
  svg: string;
}

export interface Diagnostic {
  severity: 'error' | 'warning';
  message: string;
  hints: string[];
  /** null when the diagnostic has no location in a file. */
  path: string | null;
  from: number;
  to: number;
}

export interface Position {
  page: number;
  x: number;
  y: number;
}

/** A rectangle on a page, in points from its top-left corner. */
export interface Box {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Jump =
  /** `from..to` is the syntax leaf containing `offset`, e.g. a text run. */
  | {
      kind: 'source';
      path: string;
      offset: number;
      from: number;
      to: number;
      /** Where the clicked source node is drawn: one box per line/page; empty for non-text. */
      boxes: Box[];
    }
  | { kind: 'url'; url: string }
  | ({ kind: 'position' } & Position);

/** Font file contents; a promise lets fonts download in parallel with the wasm. */
export type FontSource = Uint8Array | Promise<Uint8Array>;

/**
 * Instantiates the engine from the wasm module (URL, bytes or response). The
 * engine embeds no fonts: pass them here (`fetchFonts(DEFAULT_FONT_URLS)`, see core/engine-assets) or add them later.
 */
export async function createEngine(
  wasm: InitInput | Promise<InitInput>,
  fonts: Iterable<FontSource> = [],
): Promise<Engine> {
  const [, ...fontData] = await Promise.all([init({ module_or_path: wasm }), ...fonts]);
  const engine = new WasmEngine();
  const addFont = (data: Uint8Array) => {
    if (engine.addFont(data) === 0) throw new Error('no font found in the given data');
  };
  fontData.forEach(addFont);
  return {
    addFont,
    setSource: (path, text) => assertValidPath(engine.setSource(path, text), path),
    setBinary: (path, data) => assertValidPath(engine.setBinary(path, data), path),
    remove: (path) => engine.remove(path),
    compile: (main) => JSON.parse(engine.compile(main)),
    exportPdf: (main) => {
      const exported = engine.exportPdf(main);
      try {
        return { pdf: exported.pdf() ?? null, ...JSON.parse(exported.report()) };
      } finally {
        exported.free();
      }
    },
    jumpFromClick: (page, x, y) => {
      const json = engine.jumpFromClick(page, x, y);
      return json === undefined ? null : JSON.parse(json);
    },
    jumpFromCursor: (path, offset) => JSON.parse(engine.jumpFromCursor(path, offset)),
    boxesForRanges: (path, ranges) =>
      JSON.parse(engine.boxesForRanges(path, new Uint32Array(ranges.flatMap(({ from, to }) => [from, to])))),
  };
}

function assertValidPath(ok: boolean, path: string): void {
  if (!ok) throw new Error(`invalid project path: ${path}`);
}

/** Starts downloading every font at once; pass the result to `createEngine`. */
export function fetchFonts(urls: readonly string[]): Promise<Uint8Array>[] {
  return urls.map(fetchFont);
}

async function fetchFont(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`font ${url}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}
