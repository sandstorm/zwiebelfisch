import { defineConfig } from 'vite';

export default defineConfig({
  root: 'demo',
  build: { outDir: '../dist/demo', emptyOutDir: true },
  server: { host: '127.0.0.1', port: 5199, strictPort: true },
  optimizeDeps: {
    // wasm-bindgen packages load their .wasm via import.meta.url; prebundling breaks that
    exclude: ['@myriaddreamin/typst-ts-web-compiler', '@myriaddreamin/typst-ts-renderer'],
  },
  test: {
    root: '.',
    include: ['src/**/*.test.ts'],
  },
});
