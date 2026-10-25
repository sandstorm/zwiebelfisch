// Package store keeps the server's state in SQLite:
//   - rooms: one row per room with the whole Yjs state, written over on every store
//   - shares: the guest links of rooms (package guest), by the SHA-256 hash of their secret (never the secret)
//   - user_rooms, team_pins: the rooms each user opened or pinned, and those pinned for a team (package
//     projects)
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
		`CREATE TABLE IF NOT EXISTS user_rooms (user TEXT NOT NULL, room TEXT NOT NULL, last_opened INTEGER,
			pinned INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user, room))`,
		`CREATE TABLE IF NOT EXISTS team_pins (room TEXT PRIMARY KEY, by_name TEXT NOT NULL, at INTEGER NOT NULL)`,
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

// UserRoom is a room a user opened or pinned. LastOpened is zero for one they pinned but did not open (or
// took off their recent list).
type UserRoom struct {
	Room       string
	LastOpened time.Time
	Pinned     bool
}

// OpenedRoom records that user (a key such as "gitlab:42") opened room at, and forgets their least recently
// opened rooms beyond keep that are not pinned.
func (s *Store) OpenedRoom(user, room string, at time.Time, keep int) error {
	_, err := s.db.Exec(`INSERT INTO user_rooms (user, room, last_opened) VALUES (?, ?, ?)
		ON CONFLICT(user, room) DO UPDATE SET last_opened = excluded.last_opened`, user, room, at.UnixMilli())
	if err == nil {
		_, err = s.db.Exec(`DELETE FROM user_rooms WHERE user = ? AND pinned = 0 AND room NOT IN
			(SELECT room FROM user_rooms WHERE user = ? AND pinned = 0 ORDER BY last_opened DESC LIMIT ?)`, user, user, keep)
	}
	if err != nil {
		return fmt.Errorf("store: opened room %q: %w", room, err)
	}
	return nil
}

// PinRoom pins room for user, or unpins it (a room they never opened is then forgotten).
func (s *Store) PinRoom(user, room string, pinned bool) error {
	_, err := s.db.Exec(`INSERT INTO user_rooms (user, room, pinned) VALUES (?, ?, ?)
		ON CONFLICT(user, room) DO UPDATE SET pinned = excluded.pinned`, user, room, pinned)
	if err == nil && !pinned {
		_, err = s.db.Exec(`DELETE FROM user_rooms WHERE user = ? AND room = ? AND last_opened IS NULL`, user, room)
	}
	if err != nil {
		return fmt.Errorf("store: pin room %q: %w", room, err)
	}
	return nil
}

// ForgetRoom takes room off user's recent rooms (it stays pinned if it is).
func (s *Store) ForgetRoom(user, room string) error {
	_, err := s.db.Exec(`DELETE FROM user_rooms WHERE user = ? AND room = ? AND pinned = 0`, user, room)
	if err == nil {
		_, err = s.db.Exec(`UPDATE user_rooms SET last_opened = NULL WHERE user = ? AND room = ?`, user, room)
	}
	if err != nil {
		return fmt.Errorf("store: forget room %q: %w", room, err)
	}
	return nil
}

// UserRooms are user's rooms, the most recently opened first.
func (s *Store) UserRooms(user string) ([]UserRoom, error) {
	rows, err := s.db.Query(`SELECT room, last_opened, pinned FROM user_rooms WHERE user = ?
		ORDER BY last_opened IS NULL, last_opened DESC, room`, user)
	if err != nil {
		return nil, fmt.Errorf("store: user rooms: %w", err)
	}
	defer rows.Close()
	var rooms []UserRoom
	for rows.Next() {
		var r UserRoom
		var opened sql.NullInt64
		if err := rows.Scan(&r.Room, &opened, &r.Pinned); err != nil {
			return nil, fmt.Errorf("store: user rooms: %w", err)
		}
		if opened.Valid {
			r.LastOpened = time.UnixMilli(opened.Int64)
		}
		rooms = append(rooms, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("store: user rooms: %w", err)
	}
	return rooms, nil
}

// TeamPin is a room pinned for everyone who may open it, by whom (their name).
type TeamPin struct {
	Room, By string
	At       time.Time
}

// SetTeamPin pins room for the team as by (a name), or unpins it.
func (s *Store) SetTeamPin(room, by string, at time.Time, pinned bool) error {
	var err error
	if pinned {
		_, err = s.db.Exec(`INSERT INTO team_pins (room, by_name, at) VALUES (?, ?, ?)
			ON CONFLICT(room) DO UPDATE SET by_name = excluded.by_name, at = excluded.at`, room, by, at.UnixMilli())
	} else {
		_, err = s.db.Exec(`DELETE FROM team_pins WHERE room = ?`, room)
	}
	if err != nil {
		return fmt.Errorf("store: team pin %q: %w", room, err)
	}
	return nil
}

// TeamPins are all rooms pinned for a team, the latest first.
func (s *Store) TeamPins() ([]TeamPin, error) {
	rows, err := s.db.Query(`SELECT room, by_name, at FROM team_pins ORDER BY at DESC, room`)
	if err != nil {
		return nil, fmt.Errorf("store: team pins: %w", err)
	}
	defer rows.Close()
	var pins []TeamPin
	for rows.Next() {
		var p TeamPin
		var at int64
		if err := rows.Scan(&p.Room, &p.By, &at); err != nil {
			return nil, fmt.Errorf("store: team pins: %w", err)
		}
		p.At = time.UnixMilli(at)
		pins = append(pins, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("store: team pins: %w", err)
	}
	return pins, nil
}

// Close closes the file.
func (s *Store) Close() error { return s.db.Close() }
