// Package store keeps the server's state in SQLite:
//   - rooms: one row per room with the whole Yjs state, written over on every store
//   - shares: the guest links of rooms (package guest), by the SHA-256 hash of their secret (never the secret)
package store

import (
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite" // registers the "sqlite" driver
)

// Store is a SQLite file of room states. Safe for concurrent use.
type Store struct{ db *sql.DB }

// Memory is the path of a store that keeps nothing after Close.
const Memory = ":memory:"

// Open opens (or creates, with its directory) the SQLite file at path.
func Open(path string) (*Store, error) {
	if path != Memory {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return nil, fmt.Errorf("store: %w", err)
		}
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("store: open %s: %w", path, err)
	}
	// One connection: an in-memory database exists per connection, and SQLite writes one at a time anyway.
	db.SetMaxOpenConns(1)
	for _, table := range []string{
		`CREATE TABLE IF NOT EXISTS rooms (name TEXT PRIMARY KEY, state BLOB NOT NULL)`,
		`CREATE TABLE IF NOT EXISTS shares (id TEXT PRIMARY KEY, token_hash BLOB NOT NULL UNIQUE, room TEXT NOT NULL,
			label TEXT NOT NULL, creator_provider TEXT NOT NULL, creator_id TEXT NOT NULL, creator_name TEXT NOT NULL,
			created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)`,
	} {
		if _, err := db.Exec(table); err != nil {
			_ = db.Close()
			return nil, fmt.Errorf("store: open %s: %w", path, err)
		}
	}
	return &Store{db: db}, nil
}

// Load returns the room's state, or nil if it was never stored.
func (s *Store) Load(room string) ([]byte, error) {
	var state []byte
	err := s.db.QueryRow(`SELECT state FROM rooms WHERE name = ?`, room).Scan(&state)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("store: load %q: %w", room, err)
	}
	return state, nil
}

// Save replaces the room's state.
func (s *Store) Save(room string, state []byte) error {
	_, err := s.db.Exec(`INSERT INTO rooms (name, state) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET state = excluded.state`, room, state)
	if err != nil {
		return fmt.Errorf("store: save %q: %w", room, err)
	}
	return nil
}

// Share is a guest link of a room, as stored: TokenHash is the SHA-256 hash of its secret.
type Share struct {
	ID        string
	TokenHash []byte
	Room      string
	Label     string
	// Creator is who made it (provider, user id, name).
	CreatorProvider, CreatorID, CreatorName string
	CreatedAt, ExpiresAt                    time.Time
}

// AddShare stores a new share.
func (s *Store) AddShare(sh Share) error {
	_, err := s.db.Exec(`INSERT INTO shares (id, token_hash, room, label, creator_provider, creator_id, creator_name, created_at, expires_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, sh.ID, sh.TokenHash, sh.Room, sh.Label, sh.CreatorProvider, sh.CreatorID, sh.CreatorName,
		sh.CreatedAt.UnixMilli(), sh.ExpiresAt.UnixMilli())
	if err != nil {
		return fmt.Errorf("store: add share %s: %w", sh.ID, err)
	}
	return nil
}

// Shares are all stored shares.
func (s *Store) Shares() ([]Share, error) {
	rows, err := s.db.Query(`SELECT id, token_hash, room, label, creator_provider, creator_id, creator_name, created_at, expires_at FROM shares`)
	if err != nil {
		return nil, fmt.Errorf("store: shares: %w", err)
	}
	defer rows.Close()
	var shares []Share
	for rows.Next() {
		var sh Share
		var created, expires int64
		if err := rows.Scan(&sh.ID, &sh.TokenHash, &sh.Room, &sh.Label, &sh.CreatorProvider, &sh.CreatorID, &sh.CreatorName, &created, &expires); err != nil {
			return nil, fmt.Errorf("store: shares: %w", err)
		}
		sh.CreatedAt, sh.ExpiresAt = time.UnixMilli(created), time.UnixMilli(expires)
		shares = append(shares, sh)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("store: shares: %w", err)
	}
	return shares, nil
}

// DeleteShare removes the share id (none: nothing).
func (s *Store) DeleteShare(id string) error {
	if _, err := s.db.Exec(`DELETE FROM shares WHERE id = ?`, id); err != nil {
		return fmt.Errorf("store: delete share %s: %w", id, err)
	}
	return nil
}

// Close closes the file.
func (s *Store) Close() error { return s.db.Close() }
