import init, { Engine as WasmEngine, type InitInput } from './wasm/typst_engine';

/**
 * The Typst compiler, SVG renderer and preview hit-testing (Rust → wasm).
 *
 * Paths are project paths like `/main.typ`. Offsets are UTF-16 code units,
 * pages are 0-based, and coordinates are points from the page's top-left.
 * The engine keeps the last successfully compiled document for hit-testing.
 */
export interface Engine {
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
  /** null when the diagnostic has no location in a project file. */
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

/** Instantiates the engine from the wasm module (URL, bytes or response). */
export async function createEngine(wasm: InitInput | Promise<InitInput>): Promise<Engine> {
  await init({ module_or_path: wasm });
  const engine = new WasmEngine();
  return {
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
