// Writes yjs-fixtures.json: Yjs updates made by the real yjs (the browser's CRDT) and the texts they must
// produce. The Go side (server/lib/ydoc) applies them and compares (TestYjsFixtures). Regenerate after a yjs
// upgrade: `node server/testdata/gen-fixtures.ts`, then commit the JSON.
//
// The cases cover what rooms do: a `files` Y.Map of Y.Text, several clients editing concurrently, deletes,
// replaced map entries, and non-BMP text (emoji), where UTF-16 offsets differ from code points and bytes.
import { writeFileSync } from 'node:fs';
import * as Y from 'yjs';

interface Fixture {
  name: string;
  /** Every update each client emitted (base64 Yjs v1), in emission order per client, clients interleaved. */
  updates: string[];
  /** The converged document as one update (`Y.encodeStateAsUpdate`). */
  state: string;
  /** map name → key → text, after all updates. */
  texts: Record<string, Record<string, string>>;
}

const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');

/** Clients with fixed client ids, each recording its updates; `sync` exchanges everything (like a server). */
function clients(n: number) {
  const updates: Uint8Array[] = [];
  const docs = Array.from({ length: n }, (_, i) => {
    const doc = new Y.Doc();
    doc.clientID = i + 1;
    doc.on('update', (u: Uint8Array, origin: unknown) => {
      if (origin !== 'sync') updates.push(u);
    });
    return doc;
  });
  const sync = () => {
    for (const a of docs) for (const b of docs) if (a !== b) Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)), 'sync');
  };
  return { docs, updates, sync };
}

const files = (doc: Y.Doc) => doc.getMap<Y.Text>('files');
const text = (doc: Y.Doc, path: string) => files(doc).get(path)!;

function fixture(name: string, docs: Y.Doc[], updates: Uint8Array[], maps: string[] = ['files']): Fixture {
  const doc = docs[0];
  const texts: Fixture['texts'] = {};
  for (const m of maps) {
    texts[m] = {};
    for (const [key, value] of doc.getMap(m).entries()) if (value instanceof Y.Text) texts[m][key] = value.toString();
  }
  for (const other of docs) {
    if (JSON.stringify(other.getMap('files').toJSON()) !== JSON.stringify(doc.getMap('files').toJSON())) throw new Error(`${name}: clients diverged`);
  }
  return { name, updates: updates.map(b64), state: b64(Y.encodeStateAsUpdate(doc)), texts };
}

const fixtures: Fixture[] = [];

{
  // one client: inserts, deletes, two files
  const { docs, updates } = clients(1);
  const [a] = docs;
  a.transact(() => {
    files(a).set('/main.typ', new Y.Text('= Report\n'));
    files(a).set('/ch1.typ', new Y.Text('One'));
  });
  text(a, '/main.typ').insert(9, 'Hello world\n');
  text(a, '/main.typ').delete(0, 2);
  text(a, '/ch1.typ').insert(3, ' two three');
  text(a, '/ch1.typ').delete(4, 4);
  fixtures.push(fixture('single-client', docs, updates));
}

{
  // non-BMP text: offsets are UTF-16 units (an emoji is 2), not code points or UTF-8 bytes
  const { docs, updates } = clients(1);
  const [a] = docs;
  files(a).set('/emoji.typ', new Y.Text('a😀b𝄞c'));
  const t = text(a, '/emoji.typ');
  t.insert(3, '🎉'); // after a😀 (1 + 2 units)
  t.delete(6, 1); // the "b" after a😀🎉
  t.insert(t.length, ' ü ß ✓ 👩‍👩‍👧');
  t.delete(1, 2); // the 😀
  fixtures.push(fixture('non-bmp', docs, updates));
}

{
  // three clients typing concurrently into the same text and files, then syncing
  const { docs, updates, sync } = clients(3);
  const [a, b, c] = docs;
  files(a).set('/main.typ', new Y.Text('Hello'));
  sync();
  text(a, '/main.typ').insert(5, ' from A');
  text(b, '/main.typ').insert(0, 'B says: ');
  text(c, '/main.typ').insert(5, ' 🌍');
  text(c, '/main.typ').delete(0, 1);
  files(b).set('/b.typ', new Y.Text('only B'));
  sync();
  text(a, '/main.typ').delete(2, 5);
  text(b, '/b.typ').insert(4, '𝔅 ');
  text(c, '/main.typ').insert(text(c, '/main.typ').length, '!');
  sync();
  fixtures.push(fixture('concurrent', docs, updates));
}

{
  // map entries replaced and deleted, concurrent replacement of the same key (last writer by client id wins)
  const { docs, updates, sync } = clients(2);
  const [a, b] = docs;
  files(a).set('/x.typ', new Y.Text('first'));
  files(a).set('/gone.typ', new Y.Text('deleted later'));
  sync();
  files(a).set('/x.typ', new Y.Text('replaced by A'));
  files(b).set('/x.typ', new Y.Text('replaced by B'));
  files(b).delete('/gone.typ');
  sync();
  text(a, '/x.typ').insert(0, '» ');
  sync();
  fixtures.push(fixture('map-replace', docs, updates));
}

{
  // a longer editing session (many small updates, garbage-collected deletes), plus a second root map
  const { docs, updates } = clients(1);
  const [a] = docs;
  files(a).set('/long.typ', new Y.Text(''));
  const t = text(a, '/long.typ');
  let seed = 7;
  const random = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  const alphabet = ['a', 'b', ' ', '\n', 'é', '😀', '中'];
  for (let i = 0; i < 300; i++) {
    if (t.length > 0 && random() < 0.3) {
      const at = Math.floor(random() * t.length);
      const s = t.toString();
      // never split a surrogate pair (the editor never does either)
      const from = s.charCodeAt(at) >= 0xdc00 && s.charCodeAt(at) <= 0xdfff ? at - 1 : at;
      const unit = s.codePointAt(from)! > 0xffff ? 2 : 1;
      t.delete(from, unit);
    } else {
      const s = t.toString();
      let at = Math.floor(random() * (t.length + 1));
      if (at > 0 && at < s.length && s.charCodeAt(at) >= 0xdc00 && s.charCodeAt(at) <= 0xdfff) at -= 1;
      t.insert(at, alphabet[Math.floor(random() * alphabet.length)]);
    }
  }
  a.getMap<Y.Text>('notes').set('todo', new Y.Text('ship it ✓'));
  fixtures.push(fixture('long-session', docs, updates, ['files', 'notes']));
}

const out = new URL('./yjs-fixtures.json', import.meta.url);
writeFileSync(out, `${JSON.stringify({ yjs: '13.6.33', fixtures }, null, 1)}\n`);
console.log(`wrote ${fixtures.length} fixtures to ${out.pathname}`);
