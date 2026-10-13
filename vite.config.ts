import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { docsFiles } from './demo/docs-files/plugin.ts';

export default defineConfig({
  root: 'demo',
  build: { outDir: '../dist/demo', emptyOutDir: true },
  server: { host: '127.0.0.1', port: 5199, strictPort: true },
  // `mise run demo:build`: the built demo on the dev server's address (the playground server expects it there)
  preview: { host: '127.0.0.1', port: 5199, strictPort: true },
  worker: { format: 'es' },
  // the demo's IronCalc spreadsheets (examples.ts imports them inline)
  assetsInclude: ['**/*.ic'],
  // dev server and vite preview, not in a build: the Documentation example saves to docs/
  plugins: [docsFiles({ root: fileURLToPath(new URL('docs', import.meta.url)) })],
  test: {
    root: '.',
    // `mise run perf:typing` (ZWF_PERF) runs the measurements in tests/perf/ instead
    include: process.env.ZWF_PERF ? ['tests/perf/**/*.perf.ts'] : ['src/**/*.test.ts', 'demo/**/*.test.ts', 'eslint-rules/**/*.test.js'],
    // layout stubs for the jsdom environment (no-op in node)
    setupFiles: ['tests/jsdom-setup.ts'],
  },
});
