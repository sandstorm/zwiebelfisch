// Package projects is the start page's server side (docs/20_features/17_start-page.typ): per user the rooms
// they opened (recent) and pinned, the rooms pinned for the team, and the rooms open now. Package app mounts
// it for signed-in members, never guests:
//
//	GET          /api/me/rooms               Rooms: open now, pinned, recent
//	PUT, DELETE  /api/me/rooms/{room}/pin    Pin
//	DELETE       /api/me/rooms/{room}        Forget: off the recent list
//	PUT, DELETE  /api/rooms/{room}/team-pin  TeamPin: who MayTeamPin
//
// Opened records a room as recent when a member joins it. Open rooms and team pins are listed only to who
// MayOpen them; one's own rooms always.
package projects

import (
	"context"
	"encoding/json"
	"net/http"
	"slices"
	"time"

	"github.com/rs/zerolog"

	"github.com/sandstorm/zwiebelfisch/server/lib/collab"
	"github.com/sandstorm/zwiebelfisch/server/lib/store"
)

// MaxRecent is how many rooms a user's recent list keeps (pinned ones besides).
const MaxRecent = 50

// Options configure Projects. All are required but Log.
type Options struct {
	Store *store.Store
	// Occupied are the rooms with clients in them now (collab.Server.Occupied).
	Occupied func() map[string][]collab.User
	// MayOpen is whether user may open room now (an answer up to a minute old will do).
	MayOpen func(ctx context.Context, user collab.User, room string) (bool, error)
	// MayTeamPin is whether user may pin room for the team.
	MayTeamPin func(ctx context.Context, user collab.User, room string) (bool, error)
	Log        zerolog.Logger

	now func() time.Time // tests: instead of time.Now
}

// Projects serves the start page's rooms. Create it with New.
type Projects struct{ opts Options }

func New(opts Options) *Projects {
	if opts.now == nil {
		opts.now = time.Now
	}
	return &Projects{opts: opts}
}

// Entry is a room as GET /api/me/rooms lists it.
type Entry struct {
	Room       string   `json:"room"`
	LastOpened int64    `json:"lastOpened,omitempty"` // ms since the epoch; 0: not opened by the user
	Pinned     bool     `json:"pinned"`
	TeamPinBy  string   `json:"teamPinnedBy,omitempty"`
	People     []string `json:"people"` // who is in it now, by name
}

// List is the answer of GET /api/me/rooms: each room once, in the first list it belongs to.
type List struct {
	Open   []Entry `json:"open"`
	Pinned []Entry `json:"pinned"` // own pins and team pins
	Recent []Entry `json:"recent"`
}

// Opened records that user opened room (collab.Options.PeerChanged, on join); guests are not recorded.
func (p *Projects) Opened(room string, user collab.User) {
	if user.IsGuest() || user.ID == "" {
		return
	}
	if err := p.opts.Store.OpenedRoom(key(user), room, p.opts.now(), MaxRecent); err != nil {
		p.opts.Log.Warn().Err(err).Str("room", room).Msg("cannot record a recent room")
	}
}

// Rooms answers the user's List.
func (p *Projects) Rooms(w http.ResponseWriter, r *http.Request, user collab.User) {
	own, err := p.opts.Store.UserRooms(key(user))
	if err != nil {
		p.fail(w, err)
		return
	}
	teamPins, err := p.opts.Store.TeamPins()
	if err != nil {
		p.fail(w, err)
		return
	}
	occupied := p.opts.Occupied()
	entries := map[string]*Entry{}
	entry := func(room string) *Entry {
		if entries[room] == nil {
			entries[room] = &Entry{Room: room, People: []string{}}
			for _, u := range occupied[room] {
				entries[room].People = append(entries[room].People, u.Name)
			}
		}
		return entries[room]
	}
	for _, o := range own {
		e := entry(o.Room)
		e.Pinned = o.Pinned
		if !o.LastOpened.IsZero() {
			e.LastOpened = o.LastOpened.UnixMilli()
		}
	}
	mayOpen := func(room string) bool {
		if entries[room] != nil {
			return true
		}
		ok, err := p.opts.MayOpen(r.Context(), user, room)
		return err == nil && ok
	}
	var teamPinned []string
	for _, pin := range teamPins {
		if mayOpen(pin.Room) {
			entry(pin.Room).TeamPinBy = pin.By
			teamPinned = append(teamPinned, pin.Room)
		}
	}
	var open []string
	for room := range occupied {
		if mayOpen(room) {
			entry(room)
			open = append(open, room)
		}
	}
	slices.Sort(open)

	list := List{Open: []Entry{}, Pinned: []Entry{}, Recent: []Entry{}}
	listed := map[string]bool{}
	add := func(to *[]Entry, room string) {
		if !listed[room] {
			listed[room] = true
			*to = append(*to, *entries[room])
		}
	}
	for _, room := range open {
		add(&list.Open, room)
	}
	for _, o := range own {
		if o.Pinned {
			add(&list.Pinned, o.Room)
		}
	}
	for _, room := range teamPinned {
		add(&list.Pinned, room)
	}
	for _, o := range own {
		if !o.LastOpened.IsZero() {
			add(&list.Recent, o.Room)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(list)
}

// Pin pins {room} for user (PUT) or unpins it (DELETE).
func (p *Projects) Pin(w http.ResponseWriter, r *http.Request, user collab.User) {
	p.done(w, p.opts.Store.PinRoom(key(user), r.PathValue("room"), r.Method == http.MethodPut))
}

// Forget takes {room} off user's recent list.
func (p *Projects) Forget(w http.ResponseWriter, r *http.Request, user collab.User) {
	p.done(w, p.opts.Store.ForgetRoom(key(user), r.PathValue("room")))
}

// TeamPin pins {room} for the team (PUT) or unpins it (DELETE), if user MayTeamPin it (403 otherwise).
func (p *Projects) TeamPin(w http.ResponseWriter, r *http.Request, user collab.User) {
	room := r.PathValue("room")
	ok, err := p.opts.MayTeamPin(r.Context(), user, room)
	if err != nil || !ok {
		http.Error(w, "Only Maintainers of the project pin it for the team.", http.StatusForbidden)
		return
	}
	p.done(w, p.opts.Store.SetTeamPin(room, user.Name, p.opts.now(), r.Method == http.MethodPut))
}

func (p *Projects) done(w http.ResponseWriter, err error) {
	if err != nil {
		p.fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (p *Projects) fail(w http.ResponseWriter, err error) {
	p.opts.Log.Error().Err(err).Msg("projects")
	http.Error(w, "The server could not read or store your projects.", http.StatusInternalServerError)
}

// key is who user is in the store: "<provider>:<id>".
func key(user collab.User) string { return user.Provider + ":" + user.ID }
