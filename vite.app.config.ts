import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

// The app the zwiebelfisch binary embeds (server/lib/webapp): the start page (index.html), the editor (edit.html) and
// the local editor (local.html) → server/lib/webapp/dist/app. An entry each, so the start page loads no editor; the
// widget's npm build (vite.lib.config.ts) has none of it.
// `mise run app`: the dev server on :5200, /api proxied to `mise run server:dev`, so the session is this origin's.
export default defineConfig({
  root: 'app',
  build: {
    outDir: '../server/lib/webapp/dist/app',
    emptyOutDir: true,
    rolldownOptions: { input: { index: page('index.html'), edit: page('edit.html'), local: page('local.html') } },
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

/** /edit is edit.html (and /local local.html) in the dev server too, as the server serves the app (app.StaticFiles). */
function pagesWithoutExtension(): Plugin {
  return {
    name: 'pages-without-extension',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const page = req.url?.match(/^\/(edit|local)(?=$|[?#])/)?.[1];
        if (page) req.url = req.url!.replace(`/${page}`, `/${page}.html`);
        next();
      });
    },
  };
}
