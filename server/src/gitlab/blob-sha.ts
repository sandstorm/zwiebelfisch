import { createHash } from 'node:crypto';

/** The git blob id of `content` (what GitLab's tree lists as a file's `id`). */
export function blobSha(content: Uint8Array): string {
  return createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex');
}
