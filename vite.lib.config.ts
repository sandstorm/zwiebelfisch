import { defineConfig } from 'vite';

// Library build: one self-contained ES module (dependencies bundled, so it also
// works from a plain <script type="module">). The worker and the wasm are
// emitted as separate files and located relative to the module at runtime
// (new URL(..., import.meta.url)), so dist/lib can be served from anywhere.
export default defineConfig({
  // relative base: asset URLs become new URL('…', import.meta.url), not '/assets/…'
  base: './',
  build: {
    outDir: 'dist/lib',
    emptyOutDir: true,
    lib: { entry: 'src/index.ts', formats: ['es'], fileName: 'typst-editor' },
    // never inline the 40 MB wasm as base64
    assetsInlineLimit: 0,
    copyPublicDir: false,
  },
  worker: { format: 'es' },
});
