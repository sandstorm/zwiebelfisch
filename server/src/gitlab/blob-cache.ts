// BlobCache: GitLab blob bytes kept in memory for all rooms. See gitlab-extension.ts.
/**
 * Blob bytes by sha, shared by all rooms: a blob never changes, so a cached
 * one is always right. Least recently used blobs go first once the cache
 * holds more than `limit` bytes.
 */
export class BlobCache {
  private readonly blobs = new Map<string, Uint8Array>();
  private size = 0;
  private readonly limit: number;

  constructor(limit = 64 * 1024 * 1024) {
    this.limit = limit;
  }

  async get(sha: string, load: () => Promise<Uint8Array>): Promise<Uint8Array> {
    const cached = this.blobs.get(sha);
    if (cached) {
      this.blobs.delete(sha);
      this.blobs.set(sha, cached);
      return cached;
    }
    const content = await load();
    this.put(sha, content);
    return content;
  }

  put(sha: string, content: Uint8Array): void {
    if (this.blobs.has(sha)) return;
    this.blobs.set(sha, content);
    this.size += content.length;
    for (const [oldest, bytes] of this.blobs) {
      if (this.size <= this.limit) break;
      this.blobs.delete(oldest);
      this.size -= bytes.length;
    }
  }
}
