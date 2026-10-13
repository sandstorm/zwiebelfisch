package gitlab

import (
	"container/list"
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"sync"
)

// blobSha is the git blob id of content (what a repository tree lists as a file's id), so the room's files
// can be compared with the repository's without downloading them.
func blobSha(content []byte) string {
	h := sha1.New()
	fmt.Fprintf(h, "blob %d\x00", len(content))
	h.Write(content)
	return hex.EncodeToString(h.Sum(nil))
}

// blobCache keeps blob bytes by sha for all rooms: a blob never changes, so a cached one is always right.
// The least recently used go first once it holds more than limit bytes. Safe for concurrent use.
type blobCache struct {
	mu    sync.Mutex
	limit int
	size  int
	order *list.List // of *blobEntry, most recently used first
	bySha map[string]*list.Element
}

type blobEntry struct {
	sha     string
	content []byte
}

func newBlobCache(limit int) *blobCache {
	return &blobCache{limit: limit, order: list.New(), bySha: map[string]*list.Element{}}
}

// get returns the blob sha, loading it (outside the lock) if it is not cached.
func (c *blobCache) get(sha string, load func() ([]byte, error)) ([]byte, error) {
	c.mu.Lock()
	if e := c.bySha[sha]; e != nil {
		c.order.MoveToFront(e)
		c.mu.Unlock()
		return e.Value.(*blobEntry).content, nil
	}
	c.mu.Unlock()
	content, err := load()
	if err != nil {
		return nil, err
	}
	c.put(sha, content)
	return content, nil
}

func (c *blobCache) put(sha string, content []byte) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.bySha[sha] != nil {
		return
	}
	c.bySha[sha] = c.order.PushFront(&blobEntry{sha, content})
	c.size += len(content)
	for c.size > c.limit && c.order.Len() > 0 {
		oldest := c.order.Remove(c.order.Back()).(*blobEntry)
		delete(c.bySha, oldest.sha)
		c.size -= len(oldest.content)
	}
}
