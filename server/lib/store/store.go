// Package store keeps each room's document in SQLite: one row per room with the whole Yjs state, written
// over on every store (as Hocuspocus's SQLite extension did; rooms are small, ~100 KB).
//
// SQLite through modernc.org/sqlite needs no cgo, so the server stays one static binary.
package store

import (
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"

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
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS rooms (name TEXT PRIMARY KEY, state BLOB NOT NULL)`); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("store: open %s: %w", path, err)
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

// Close closes the file.
func (s *Store) Close() error { return s.db.Close() }
