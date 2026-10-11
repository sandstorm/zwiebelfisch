// withPackages: Typst packages (@preview/…) downloaded on first use and added to the engine. Entry of
// core/typst-packages/. See docs/architecture/core.typ.
import { SourceRange } from '../typst-document/typst-document';
import type { CompileResult, TypstDiagnostic, TypstEngine, PdfResult } from '../typst-engine/typst-engine';
import { untarGz } from './tar';

/** Returns the `.tar.gz` archive of a package spec like `@preview/name:0.1.0`. */
export type PackageFetcher = (spec: string) => Promise<Uint8Array>;

/** An engine's compile and PDF export, downloading the packages a document imports on the way. */
export interface PackageEngine {
  /**
   * Compiles `main`; packages the document imports that the engine does not
   * have yet are downloaded, added, and the document compiled again. A package
   * that fails to download is reported as a diagnostic and not tried again.
   */
  compile(main: string): Promise<CompileResult>;
  /** `TypstEngine.exportPdf`, with packages downloaded like `compile`. */
  exportPdf(main: string): Promise<PdfResult>;
}

/**
 * Lets documents compiled by `engine` import packages, fetched on first use
 * with `fetchPackage` (default: from packages.typst.org, cached).
 */
export function withPackages(engine: TypstEngine, fetchPackage: PackageFetcher = fetchPreviewPackage): PackageEngine {
  const failed = new Map<string, string>();
  const load = async (spec: string) => {
    try {
      const files = await untarGz(await fetchPackage(spec));
      if (files.size === 0) throw new Error('the archive has no files');
      addPackage(engine, spec, files);
    } catch (error) {
      failed.set(spec, error instanceof Error ? error.message : String(error));
    }
  };
  /** Runs `task` until it misses no package that could still be downloaded. */
  const withDownloads = async <R extends CompileResult | PdfResult>(task: () => R): Promise<R> => {
    for (;;) {
      const result = task();
      const wanted = result.missingPackages.filter((spec) => !failed.has(spec));
      if (wanted.length === 0) return withFailures(result, failed);
      await Promise.all(wanted.map(load));
    }
  };
  return {
    compile: (main) => withDownloads(() => engine.compile(main)),
    exportPdf: (main) => withDownloads(() => engine.exportPdf(main)),
  };
}

/** Package files live under `@namespace/name:version/` paths in the engine. */
function addPackage(engine: TypstEngine, spec: string, files: Map<string, Uint8Array>): void {
  const decoder = new TextDecoder();
  for (const [path, data] of files) {
    const full = `${spec}/${path}`;
    if (path.endsWith('.typ')) engine.setSource(full, decoder.decode(data));
    else engine.setBinary(full, data);
  }
}

function withFailures<R extends { diagnostics: TypstDiagnostic[]; missingPackages: string[] }>(result: R, failed: Map<string, string>): R {
  const failures: TypstDiagnostic[] = result.missingPackages.map((spec) => ({
    severity: 'error',
    message: `could not download package ${spec}: ${failed.get(spec)}`,
    hints: [],
    path: null,
    ...SourceRange.of({ from: 0, to: 0 }),
  }));
  return { ...result, diagnostics: [...result.diagnostics, ...failures] };
}

const REGISTRY = 'https://packages.typst.org/preview/';
const CACHE = 'typst-packages';

/**
 * Downloads an `@preview` package archive from packages.typst.org. Versions
 * are immutable, so archives are kept in the Cache API where available.
 */
async function fetchPreviewPackage(spec: string): Promise<Uint8Array> {
  const match = /^@preview\/([^:/]+):([^:/]+)$/.exec(spec);
  if (!match) throw new Error(`only @preview packages can be downloaded, not ${spec}`);
  const url = `${REGISTRY}${match[1]}-${match[2]}.tar.gz`;
  const cache = await openCache();
  const response = (await cache?.match(url)) ?? (await download(url, cache));
  return new Uint8Array(await response.arrayBuffer());
}

async function download(url: string, cache: Cache | undefined): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  await cache?.put(url, response.clone()).catch(() => {});
  return response;
}

async function openCache(): Promise<Cache | undefined> {
  if (typeof caches === 'undefined') return undefined;
  return caches.open(CACHE).catch(() => undefined);
}
