// Real HocuspocusProvider clients (the widget's, @hocuspocus/provider) against the Go collaboration server,
// for the Go tests: TestRealHocuspocusProvider (in-process, over stdio) and TestServerBinary (the built
// binary on a port).
//
//   node server/testdata/hocuspocus-clients.ts <scenario> <token> [ws://host:port]
//
// Without a URL the WebSockets are bridged over stdin/stdout (one JSON line per event, see StdioSocket), so
// the test needs no port: the sandbox the tests run in cannot bind one. The scenario's result is printed as
// a line {"t":"result",...}; failures exit with status 1.
//   edit: two clients edit one room and see each other's text and presence; a third with a wrong token is
//         refused and gets nothing.
//   read: one client prints what the room holds (after a server restart).
import { HocuspocusProvider } from '@hocuspocus/provider';
import { createInterface } from 'node:readline';
import * as Y from 'yjs';

const [scenario, token, url] = process.argv.slice(2);
const room = 'spike';

const print = (line: object) => process.stdout.write(`${JSON.stringify(line)}\n`);

// A WebSocket whose bytes travel as JSON lines: {"c":id,"t":"open"|"msg"|"close","d":base64,"code":n}.
class StdioSocket {
  static readonly all = new Map<number, StdioSocket>();
  static next = 1;
  readonly id = StdioSocket.next++;
  readyState = 0;
  binaryType = 'arraybuffer';
  readonly url: string;
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>();

  constructor(url: string) {
    this.url = url;
    StdioSocket.all.set(this.id, this);
    print({ c: this.id, t: 'open' });
    setTimeout(() => {
      this.readyState = 1;
      this.emit('open', {});
    });
  }

  addEventListener(name: string, fn: (event: unknown) => void) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name)!.add(fn);
  }

  removeEventListener(name: string, fn: (event: unknown) => void) {
    this.listeners.get(name)?.delete(fn);
  }

  send(data: Uint8Array) {
    if (this.readyState === 1) print({ c: this.id, t: 'msg', d: Buffer.from(data).toString('base64') });
  }

  close(code = 1000, reason = '') {
    if (this.readyState >= 2) return;
    print({ c: this.id, t: 'close' });
    this.closed(code, reason);
  }

  closed(code: number, reason: string) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    setTimeout(() => this.emit('close', { code, reason }));
  }

  emit(name: string, event: unknown) {
    for (const fn of this.listeners.get(name) ?? []) fn(event);
  }
}

if (!url) {
  createInterface({ input: process.stdin }).on('line', (line) => {
    const { c, t, d, code } = JSON.parse(line) as { c: number; t: string; d?: string; code?: number };
    const socket = StdioSocket.all.get(c);
    if (!socket) return;
    if (t === 'msg') {
      const bytes = Buffer.from(d!, 'base64');
      socket.emit('message', { data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
    } else if (t === 'close') socket.closed(code ?? 1000, '');
  });
}

const providers: HocuspocusProvider[] = [];
function client(token: string, events: { onAuthenticationFailed?: (data: { reason: string }) => void } = {}) {
  const provider = new HocuspocusProvider({
    url: url ?? 'ws://stdio',
    name: room,
    token,
    document: new Y.Doc(),
    ...(url ? {} : { WebSocketPolyfill: StdioSocket }),
    ...events,
  });
  providers.push(provider);
  return provider;
}

const files = (p: HocuspocusProvider) => p.document.getMap<Y.Text>('files');
const texts = (p: HocuspocusProvider) => Object.fromEntries([...files(p).entries()].map(([k, v]) => [k, v.toString()]));

async function until(what: string, ok: () => boolean, ms = 10_000) {
  const start = Date.now();
  while (!ok()) {
    if (Date.now() - start > ms) throw new Error(`timed out waiting until ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function edit() {
  const a = client(token);
  const b = client(token);
  await until('both are synced', () => a.synced && b.synced);

  a.document.transact(() => files(a).set('/main.typ', new Y.Text('Hello 😀')));
  await until('b sees a\'s text', () => files(b).get('/main.typ')?.toString() === 'Hello 😀');
  files(b).get('/main.typ')!.insert(8, ' and B 𝄞');
  files(b).get('/main.typ')!.insert(0, '» ');
  await until('a sees b\'s edits', () => files(a).get('/main.typ')?.toString() === '» Hello 😀 and B 𝄞');

  a.awareness!.setLocalStateField('user', { name: 'A' });
  await until('b sees a\'s presence', () => b.awareness!.getStates().get(a.document.clientID)?.user?.name === 'A');
  await until('the server acknowledged every update', () => !a.hasUnsyncedChanges && !b.hasUnsyncedChanges);

  let denied = '';
  const intruder = client('wrong', { onAuthenticationFailed: ({ reason }) => (denied = reason) });
  await until('the wrong token is refused', () => denied !== '');
  await new Promise((resolve) => setTimeout(resolve, 100));

  b.destroy();
  await until('a sees b leave', () => !a.awareness!.getStates().has(b.document.clientID));
  return { texts: texts(a), denied, intruderTexts: texts(intruder), intruderSynced: intruder.synced };
}

async function read() {
  const d = client(token);
  await until('synced', () => d.synced);
  return { texts: texts(d) };
}

try {
  const result = await ({ edit, read } as Record<string, () => Promise<object>>)[scenario]();
  print({ t: 'result', ...result });
} catch (error) {
  print({ t: 'error', message: String(error) });
  process.exitCode = 1;
} finally {
  for (const p of providers) p.destroy();
  setTimeout(() => process.exit(), 50);
}
