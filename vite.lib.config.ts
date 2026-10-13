import { defineConfig } from 'vite';

// Library build: one self-contained ES module (dependencies bundled, so it also
// works from a plain <script type="module">). The worker and the wasm are
// emitted as separate files and located relative to the module at runtime
// (new URL(..., import.meta.url)), so dist/lib can be served from anywhere.
// Every emitted file has its content's hash in the name (the wasm
// typst_engine_bg.<hash>.wasm, the fonts fonts/<name>.<hash>.otf), so a host
// server may cache them forever (docs/30_reference/02_embedding.typ).
export default defineConfig({
  // relative base: asset URLs become new URL('…', import.meta.url), not '/assets/…'
  base: './',
  // library mode leaves process.env.NODE_ENV to the consumer's bundler; a plain <script type="module"> has none,
  // so the bundled React (IronCalc's spreadsheets) would throw "process is not defined"
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: 'dist/lib',
    emptyOutDir: true,
    lib: { entry: 'src/index.ts', formats: ['es'], fileName: 'zwiebelfisch' },
    // never inline the 40 MB wasm as base64
    assetsInlineLimit: 0,
    copyPublicDir: false,
    rolldownOptions: {
      output: {
        // library mode would name assets without a hash
        assetFileNames: ({ names }) => (/\.(otf|ttf)$/.test(names[0] ?? '') ? 'fonts/[name].[hash][extname]' : '[name].[hash][extname]'),
      },
    },
  },
  worker: { format: 'es' },
});
