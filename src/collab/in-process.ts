import * as Y from 'yjs';

/**
 * Connects Y.Docs in-process, the way a server would: every update of one is
 * applied to the others (for tests). Returns the function that disconnects
 * them again; `reconnect` exchanges what was missed meanwhile.
 */
export function connect(...docs: Y.Doc[]): () => void {
  const handlers = docs.map((doc) => {
    const handler = (update: Uint8Array, origin: unknown) => {
      for (const other of docs) if (other !== doc && origin !== other) Y.applyUpdate(other, update, doc);
    };
    doc.on('update', handler);
    return () => doc.off('update', handler);
  });
  for (const doc of docs) for (const other of docs) if (other !== doc) Y.applyUpdate(other, Y.encodeStateAsUpdate(doc), doc);
  return () => handlers.forEach((off) => off());
}
