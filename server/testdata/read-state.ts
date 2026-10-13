// Decodes a Yjs state written by the Go server (server/lib/ydoc) with the real yjs and prints its texts as
// JSON (map name → key → text), for TestStateReadByYjs. Usage: node server/testdata/read-state.ts <file> <map>...
// The file holds the state as base64.
import { readFileSync } from 'node:fs';
import * as Y from 'yjs';

const [file, ...maps] = process.argv.slice(2);
const doc = new Y.Doc();
Y.applyUpdate(doc, Buffer.from(readFileSync(file, 'utf8'), 'base64'));
const texts: Record<string, Record<string, string>> = {};
for (const m of maps) {
  texts[m] = {};
  for (const [key, value] of doc.getMap(m).entries()) if (value instanceof Y.Text) texts[m][key] = value.toString();
}
// a state Yjs cannot fully integrate leaves pending structs: that is a broken encoding, not a valid state
if (doc.store.pendingStructs !== null || doc.store.pendingDs !== null) throw new Error('state has pending structs');
console.log(JSON.stringify(texts));
