import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

// The app a deployment serves (docs/30_configuration/05_deployment.typ): the start page (index.html) and the editor
// (edit.html) → dist/app, served by the server from ZWF_WEB_DIST next to /api/. Two entries, so the start page loads
// no editor; the widget's npm build (vite.lib.config.ts) has none of it.
// `mise run app`: the dev server on :5200, /api proxied to `mise run server:dev`, so the session is this origin's.
export default defineConfig({
  root: 'app',
  build: {
    outDir: '../dist/app',
    emptyOutDir: true,
    rolldownOptions: { input: { index: page('index.html'), edit: page('edit.html') } },
  },
  server: {
    host: '127.0.0.1',
    port: 5200,
    strictPort: true,
    proxy: { '/api': { target: 'http://127.0.0.1:1234', ws: true } },
  },
  plugins: [pagesWithoutExtension()],
  worker: { format: 'es' },
  assetsInclude: ['**/*.ic'],
});

function page(name: string): string {
  return fileURLToPath(new URL(`app/${name}`, import.meta.url));
}

/** /edit is edit.html in the dev server too, as the server serves dist/app (app.StaticFiles). */
function pagesWithoutExtension(): Plugin {
  return {
    name: 'pages-without-extension',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url === '/edit' || req.url?.startsWith('/edit?')) req.url = req.url.replace('/edit', '/edit.html');
        next();
      });
    },
  };
}
