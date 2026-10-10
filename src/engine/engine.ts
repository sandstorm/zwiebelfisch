import init, { Engine as WasmEngine, type InitInput } from './wasm/typst_engine';

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
  /** What is at a point of the last compiled document, or null for empty space. */
  jumpFromClick(page: number, x: number, y: number): Jump | null;
  /** Where the text at `offset` appears in the last compiled document. */
  jumpFromCursor(path: string, offset: number): Position[];
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

export type Jump =
  /** `from..to` is the syntax leaf containing `offset`, e.g. a text run. */
  | { kind: 'source'; path: string; offset: number; from: number; to: number }
  | { kind: 'url'; url: string }
  | ({ kind: 'position' } & Position);

/** Font file contents; a promise lets fonts download in parallel with the wasm. */
export type FontSource = Uint8Array | Promise<Uint8Array>;

/**
 * Instantiates the engine from the wasm module (URL, bytes or response). The
 * engine embeds no fonts: pass them here (see `defaultFonts()`) or add them later.
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
    jumpFromClick: (page, x, y) => {
      const json = engine.jumpFromClick(page, x, y);
      return json === undefined ? null : JSON.parse(json);
    },
    jumpFromCursor: (path, offset) => JSON.parse(engine.jumpFromCursor(path, offset)),
  };
}

function assertValidPath(ok: boolean, path: string): void {
  if (!ok) throw new Error(`invalid project path: ${path}`);
}
