// Development collaboration server: `mise run server:dev`.
//   PORT                (default 1234)       the demo connects to ws://127.0.0.1:1234 with ?room=<name>
//   TYPST_COLLAB_DB     (default server/.data/collab.sqlite)
//   TYPST_COLLAB_TOKEN  (default unset: no check) the token clients must send
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { sharedToken } from './auth.ts';
import { createCollabServer } from './collab-server.ts';

const database = process.env.TYPST_COLLAB_DB ?? 'server/.data/collab.sqlite';
mkdirSync(dirname(database), { recursive: true });

const server = createCollabServer({
  port: Number(process.env.PORT ?? 1234),
  database,
  authenticate: sharedToken(process.env.TYPST_COLLAB_TOKEN),
});
await server.listen();
