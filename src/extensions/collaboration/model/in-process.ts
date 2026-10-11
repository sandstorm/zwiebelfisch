// Test wiring: Y.Docs and awarenesses connected in-process, without a server. See Collaboration in model.ts.
import { applyAwarenessUpdate, encodeAwarenessUpdate, type Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';

/** Forwards awareness (presence) updates between `awarenesses` in-process (for tests). */
export function connectAwareness(...awarenesses: Awareness[]): void {
  for (const awareness of awarenesses) {
    awareness.on('update', ({ added, updated, removed }: Record<string, number[]>, origin: unknown) => {
      const update = encodeAwarenessUpdate(awareness, [...added, ...updated, ...removed]);
      for (const other of awarenesses) if (other !== awareness && origin !== other) applyAwarenessUpdate(other, update, awareness);
    });
  }
}

/**
 * Connects Y.Docs in-process, the way a server would: every update of one is
 * applied to the others (for tests), after exchanging what each misses (so
 * connecting again after a disconnect catches up). Returns the function that
 * disconnects them again.
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
