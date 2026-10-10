import { defineConfig } from 'vite';

export default defineConfig({
  root: 'demo',
  build: { outDir: '../dist/demo', emptyOutDir: true },
  server: { host: '127.0.0.1', port: 5199, strictPort: true },
  worker: { format: 'es' },
  test: {
    root: '.',
    include: ['src/**/*.test.ts'],
  },
});
