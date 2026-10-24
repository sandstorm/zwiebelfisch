// Package guest lets members share one room with people who have no account (guests), by a link whose
// secret only the link holds. Its handlers (package app mounts them):
//
//	Join    POST   /api/public/guest/join {token, name}   signs the browser in as a guest of the link's share
//	Create  POST   /api/rooms/{room}/shares {label, days}  a new share: its secret, answered once (members)
//	List    GET    /api/rooms/{room}/shares                the room's active shares (members); the guest's own (guests)
//	Revoke  DELETE /api/rooms/{room}/shares/{id}           ends a share (members)
//
// Who may share a room, and so list and revoke its shares, is MayShare's to say. Guests are collab.Users of
// collab.GuestProvider, named "<name> (guest)"; app.authenticate asks Authorize for them.
//
// Guarantees:
//   - A guest opens the share's room only, until the share expires or is revoked. Then the share's guest
//     sessions end and their clients are refused (collab's Disconnect) with ReasonEnded.
//   - Only the SHA-256 hash of a share's secret is stored (package store), so shares survive a restart; the
//     secret is never stored or logged. Guest sessions live in memory: a restart ends them.
//   - Every failed join gets the same 404, whatever failed; joins are limited per IP and in all.
//   - A share's creator is asked about again (MayShare) at each join and every SweepInterval: a creator who
//     may no longer share loses their shares; one who cannot be asked for now keeps them. Each sweep also
//     ends the shares that expired, should the expiry timer be late.
//   - Members are told of every change (a share made, revoked or expired, a guest in or out of the room):
//     MsgChanged, a stateless message to the room.
package guest

import (
	"cmp"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"mime"
	"net"
	"net/http"
	"slices"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/rs/zerolog"

	"github.com/sandstorm/zwiebelfisch/server/lib/auth"
	"github.com/sandstorm/zwiebelfisch/server/lib/collab"
	"github.com/sandstorm/zwiebelfisch/server/lib/store"
)

// Options configure Guests. All but Log are required.
type Options struct {
	Store    *store.Store
	Sessions Sessions
	Rooms    Rooms
	// MayShare is whether user may share room now: true, false (GitLab says no), or an error when that
	// cannot be told now (they are signed out, GitLab cannot be reached).
	MayShare func(ctx context.Context, user collab.User, room string) (bool, error)
	Log      zerolog.Logger

	now func() time.Time // tests
}

// Sessions are the sign-in's sessions: auth.Auth.
type Sessions interface {
	StartSession(w http.ResponseWriter, r *http.Request, identity auth.Identity, expires time.Time)
	EndSessions(match func(auth.Identity) bool)
}

// Rooms are the collaboration server's rooms: collab.Server.
type Rooms interface {
	BroadcastStateless(room, payload string)
	Disconnect(match func(*collab.Peer) bool, reason string)
}

// The lifetimes a share may have, in days (Create's days); DefaultDays without one.
var Lifetimes = []int{1, 7, 30}

const (
	DefaultDays = 7
	// MaxShares is the most active shares a room has at once.
	MaxShares = 10
	// SweepInterval is how often the creators of the active shares are asked about again.
	SweepInterval = 10 * time.Minute
	// ReasonEnded is what a guest's client is told when their access ends (expiry, revocation).
	ReasonEnded = "Guest access to this project has ended."
	// MsgChanged is the stateless message (JSON) that tells a room's clients its shares or guests changed.
	MsgChanged = `{"type":"guests:changed"}`

	joinsPerIP   = 10  // per minute
	joinsInAll   = 100 // per minute
	maxLabel     = 80  // characters
	maxName      = 64  // characters
	maxBody      = 4 << 10
	notFound     = "This link is invalid or has expired."
	guestSuffix  = " (guest)"
	sweepTimeout = time.Minute
)

// Guests are the shares of a server's rooms and their guests. Create them with New; Close them after the
// HTTP server is shut down.
type Guests struct {
	opts   Options
	joins  limiter
	ctx    context.Context // ends with Close: the sweeps
	cancel context.CancelFunc
	tasks  sync.WaitGroup

	mu     sync.Mutex
	shares map[string]store.Share       // the active ones, by id
	online map[string]map[string]online // by share id, by guest subject: who of its guests is in the room
	expiry *time.Timer                  // at the earliest expiry
}

type online struct {
	name    string
	clients int
}

// New returns the guests of opts.Store's shares (dropping the expired ones), sweeping until Close.
func New(opts Options) (*Guests, error) {
	if opts.now == nil {
		opts.now = time.Now
	}
	stored, err := opts.Store.Shares()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithCancel(context.Background())
	g := &Guests{
		opts: opts, joins: limiter{perIP: map[string]int{}}, ctx: ctx, cancel: cancel,
		shares: map[string]store.Share{}, online: map[string]map[string]online{},
	}
	for _, sh := range stored {
		g.shares[sh.ID] = sh
	}
	g.expire()
	g.tasks.Add(1)
	go func() {
		defer g.tasks.Done()
		ticker := time.NewTicker(SweepInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				g.sweep()
			case <-ctx.Done():
				return
			}
		}
	}()
	return g, nil
}

// Close stops the sweeps and expiry and waits for what they started.
func (g *Guests) Close() {
	g.cancel()
	g.mu.Lock()
	if g.expiry != nil {
		g.expiry.Stop()
	}
	g.mu.Unlock()
	g.tasks.Wait()
}

// Authorize decides whether the guest user may open room: nil for the room of their share while it lasts,
// else a collab.Refusal saying why not.
func (g *Guests) Authorize(user collab.User, room string) error {
	sh, ok := g.shareOf(user)
	switch {
	case !ok:
		return collab.Refusal{Reason: ReasonEnded}
	case sh.Room != room:
		return collab.Refusal{Reason: "This guest link is for another project."}
	}
	return nil
}

// PeerChanged follows who of the guests is in their room (collab.Options.PeerChanged) and tells the room.
func (g *Guests) PeerChanged(room string, user collab.User, joined bool) {
	sh, ok := g.shareOf(user)
	if !ok {
		return
	}
	g.mu.Lock()
	guests := g.online[sh.ID]
	if guests == nil {
		guests = map[string]online{}
		g.online[sh.ID] = guests
	}
	o := guests[user.ID]
	o.name = user.Name
	if joined {
		o.clients++
	} else {
		o.clients--
	}
	if o.clients > 0 {
		guests[user.ID] = o
	} else {
		delete(guests, user.ID)
	}
	g.mu.Unlock()
	g.goTask(func() { g.opts.Rooms.BroadcastStateless(room, MsgChanged) })
}

// Join signs the browser in as a guest of the share whose secret the JSON body's token is, named after its
// name (POST /api/public/guest/join): 204 with the session cookie; the same 404 for every link that does
// not let in (unknown, expired, revoked, its creator may no longer share), and for a request from another
// site's page or not of JSON; 400 for a missing name (or one with < or >), 429 beyond the join limits.
func (g *Guests) Join(w http.ResponseWriter, r *http.Request) {
	auth.AllowCredentials(w, r)
	w.Header().Set("Cache-Control", "no-store")
	if !auth.AllowedOrigin(r) || !isJSON(r) {
		http.Error(w, notFound, http.StatusNotFound)
		return
	}
	if !g.joins.allow(clientIP(r), g.opts.now()) {
		http.Error(w, "Too many attempts; try again in a minute.", http.StatusTooManyRequests)
		return
	}
	var body struct {
		Token string `json:"token"`
		Name  string `json:"name"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBody)).Decode(&body) != nil {
		http.Error(w, notFound, http.StatusNotFound)
		return
	}
	name, ok := cleanText(body.Name, maxName)
	if !ok || strings.ContainsAny(name, "<>") { // as in a Co-authored-by trailer's "Name <email>"
		http.Error(w, fmt.Sprintf("Enter your name (at most %d characters, no < or >).", maxName), http.StatusBadRequest)
		return
	}
	sh, ok := g.byToken(body.Token)
	if ok && !g.creatorMayShare(r.Context(), sh) {
		ok = false
	}
	if !ok {
		http.Error(w, notFound, http.StatusNotFound)
		return
	}
	identity := auth.Identity{Provider: collab.GuestProvider, Subject: sh.ID + "/" + rand.Text(), Name: name + guestSuffix}
	g.opts.Sessions.StartSession(w, r, identity, sh.ExpiresAt)
	g.opts.Log.Info().Str("share", sh.ID).Str("room", sh.Room).Str("guest", identity.Name).Msg("guest joined")
	w.WriteHeader(http.StatusNoContent)
}

// Create makes a share of the room {room} for the signed-in member, with the JSON body's label and days (one
// of Lifetimes; 0: DefaultDays): 201 with the share and its secret (token; answered this once only). 403
// for a guest or a member who may not share the room, 400 for a bad body, 409 beyond MaxShares.
func (g *Guests) Create(w http.ResponseWriter, r *http.Request) {
	room := r.PathValue("room")
	creator, ok := g.member(w, r, room)
	if !ok {
		return
	}
	var body struct {
		Label string `json:"label"`
		Days  int    `json:"days"`
	}
	if !isJSON(r) || json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBody)).Decode(&body) != nil {
		http.Error(w, "Send the share as JSON: {label, days}.", http.StatusBadRequest)
		return
	}
	label, ok := cleanText(body.Label, maxLabel)
	if !ok {
		http.Error(w, fmt.Sprintf("Name whom the link is for (at most %d characters).", maxLabel), http.StatusBadRequest)
		return
	}
	if body.Days == 0 {
		body.Days = DefaultDays
	}
	if !slices.Contains(Lifetimes, body.Days) {
		http.Error(w, fmt.Sprintf("A guest link lasts %v days.", Lifetimes), http.StatusBadRequest)
		return
	}
	token := rand.Text()
	hash := sha256.Sum256([]byte(token))
	now := g.opts.now()
	sh := store.Share{
		ID: rand.Text(), TokenHash: hash[:], Room: room, Label: label,
		CreatorProvider: creator.Provider, CreatorID: creator.ID, CreatorName: creator.Name,
		CreatedAt: now, ExpiresAt: now.Add(time.Duration(body.Days) * 24 * time.Hour),
	}
	g.mu.Lock()
	if g.activeIn(room) >= MaxShares {
		g.mu.Unlock()
		http.Error(w, fmt.Sprintf("This project has %d guest links, the most it may have; revoke one first.", MaxShares), http.StatusConflict)
		return
	}
	if err := g.opts.Store.AddShare(sh); err != nil {
		g.mu.Unlock()
		g.opts.Log.Error().Err(err).Msg("cannot store a share")
		http.Error(w, "Cannot store the guest link.", http.StatusInternalServerError)
		return
	}
	g.shares[sh.ID] = sh
	g.armExpiry()
	g.mu.Unlock()
	g.opts.Log.Info().Str("share", sh.ID).Str("room", room).Str("by", creator.ID).Int("days", body.Days).Msg("share created")
	g.opts.Rooms.BroadcastStateless(room, MsgChanged)
	view := g.view(sh, true)
	view.Token = token
	reply(w, http.StatusCreated, view)
}

// List answers the active shares of the room {room} ({shares: [...]}, earliest expiry first): to a member who
// may share it, every one with the names of its guests in the room; to a guest of the room, their own share
// only (no id, no names).
func (g *Guests) List(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	room := r.PathValue("room")
	identity, _ := auth.SignedIn(r)
	views := []shareView{}
	if user := userOf(identity); user.IsGuest() {
		if sh, ok := g.shareOf(user); ok && sh.Room == room {
			views = append(views, g.view(sh, false))
		}
	} else {
		if _, ok := g.member(w, r, room); !ok {
			return
		}
		g.mu.Lock()
		for _, sh := range g.shares {
			if sh.Room == room && g.opts.now().Before(sh.ExpiresAt) {
				views = append(views, g.viewLocked(sh, true))
			}
		}
		g.mu.Unlock()
		slices.SortFunc(views, func(a, b shareView) int { return cmp.Compare(a.ExpiresAt, b.ExpiresAt) })
	}
	reply(w, http.StatusOK, struct {
		Shares []shareView `json:"shares"`
	}{views})
}

// Revoke ends the share {id} of the room {room} for a member who may share the room: 204; 404 for a share
// that is not the room's.
func (g *Guests) Revoke(w http.ResponseWriter, r *http.Request) {
	room := r.PathValue("room")
	member, ok := g.member(w, r, room)
	if !ok {
		return
	}
	g.mu.Lock()
	sh, ok := g.shares[r.PathValue("id")]
	g.mu.Unlock()
	if !ok || sh.Room != room {
		http.Error(w, "No such guest link.", http.StatusNotFound)
		return
	}
	g.end([]store.Share{sh}, "revoked by "+member.ID)
	w.WriteHeader(http.StatusNoContent)
}

// shareView is a share as List and Create answer it.
type shareView struct {
	ID        string   `json:"id,omitempty"`
	Label     string   `json:"label"`
	SharedBy  string   `json:"sharedBy"`
	CreatedAt int64    `json:"createdAt"` // milliseconds since the epoch
	ExpiresAt int64    `json:"expiresAt"`
	Online    []string `json:"online,omitempty"` // the names of its guests in the room (members only)
	Token     string   `json:"token,omitempty"`  // Create only: the link's secret
}

func (g *Guests) view(sh store.Share, member bool) shareView {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.viewLocked(sh, member)
}

func (g *Guests) viewLocked(sh store.Share, member bool) shareView {
	v := shareView{Label: sh.Label, SharedBy: sh.CreatorName, CreatedAt: sh.CreatedAt.UnixMilli(), ExpiresAt: sh.ExpiresAt.UnixMilli()}
	if member {
		v.ID = sh.ID
		for _, o := range g.online[sh.ID] {
			v.Online = append(v.Online, o.name)
		}
		slices.Sort(v.Online)
	}
	return v
}

// member is the signed-in member who may share room, or false with the refusal answered (403).
func (g *Guests) member(w http.ResponseWriter, r *http.Request, room string) (collab.User, bool) {
	identity, _ := auth.SignedIn(r)
	user := userOf(identity)
	if user.IsGuest() {
		http.Error(w, "Guests cannot share.", http.StatusForbidden)
		return collab.User{}, false
	}
	may, err := g.opts.MayShare(r.Context(), user, room)
	if !may {
		reason := "You may not share this project."
		var refusal collab.Refusal
		if errors.As(err, &refusal) {
			reason = refusal.Reason
		}
		http.Error(w, reason, http.StatusForbidden)
		return collab.User{}, false
	}
	return user, true
}

// shareOf is the active share of the guest user.
func (g *Guests) shareOf(user collab.User) (store.Share, bool) {
	if !user.IsGuest() {
		return store.Share{}, false
	}
	id, _, _ := strings.Cut(user.ID, "/")
	g.mu.Lock()
	defer g.mu.Unlock()
	sh, ok := g.shares[id]
	return sh, ok && g.opts.now().Before(sh.ExpiresAt)
}

// byToken is the active share whose secret token is (every share compared, in constant time).
func (g *Guests) byToken(token string) (store.Share, bool) {
	hash := sha256.Sum256([]byte(token))
	g.mu.Lock()
	defer g.mu.Unlock()
	var found store.Share
	ok := false
	for _, sh := range g.shares {
		if subtle.ConstantTimeCompare(sh.TokenHash, hash[:]) == 1 {
			found, ok = sh, true
		}
	}
	return found, ok && g.opts.now().Before(found.ExpiresAt)
}

// activeIn counts the active shares of room. Called with mu held.
func (g *Guests) activeIn(room string) int {
	n := 0
	for _, sh := range g.shares {
		if sh.Room == room && g.opts.now().Before(sh.ExpiresAt) {
			n++
		}
	}
	return n
}

// creatorMayShare is whether sh's creator may still share its room; a creator GitLab says may not loses the
// share (it ends). One who cannot be asked for now may.
func (g *Guests) creatorMayShare(ctx context.Context, sh store.Share) bool {
	may, err := g.opts.MayShare(ctx, creatorOf(sh), sh.Room)
	if err != nil {
		g.opts.Log.Debug().Str("share", sh.ID).Msg("cannot ask whether the creator may still share: kept")
		return true
	}
	if !may {
		g.end([]store.Share{sh}, "its creator may no longer share")
	}
	return may
}

// sweep ends the shares that expired (whether the expiry timer fired or not) and asks about the creators
// of the others again.
func (g *Guests) sweep() {
	g.expire()
	g.mu.Lock()
	shares := make([]store.Share, 0, len(g.shares))
	for _, sh := range g.shares {
		shares = append(shares, sh)
	}
	g.mu.Unlock()
	ctx, cancel := context.WithTimeout(g.ctx, sweepTimeout)
	defer cancel()
	for _, sh := range shares {
		g.creatorMayShare(ctx, sh)
	}
}

// expire ends the shares that expired and arms the timer for the next expiry.
func (g *Guests) expire() {
	now := g.opts.now()
	var expired []store.Share
	g.mu.Lock()
	for _, sh := range g.shares {
		if !now.Before(sh.ExpiresAt) {
			expired = append(expired, sh)
		}
	}
	g.mu.Unlock()
	if len(expired) > 0 {
		g.end(expired, "expired")
	}
	g.mu.Lock()
	g.armExpiry()
	g.mu.Unlock()
}

// armExpiry sets the timer to the earliest expiry of the shares. Called with mu held.
func (g *Guests) armExpiry() {
	if g.expiry != nil {
		g.expiry.Stop()
		g.expiry = nil
	}
	if g.ctx.Err() != nil || len(g.shares) == 0 {
		return
	}
	var next time.Time
	for _, sh := range g.shares {
		if next.IsZero() || sh.ExpiresAt.Before(next) {
			next = sh.ExpiresAt
		}
	}
	g.expiry = time.AfterFunc(next.Sub(g.opts.now()), func() { g.task(g.expire) })
}

// end removes shares (stored and here), ends their guests' sessions, refuses their clients and tells
// their rooms.
func (g *Guests) end(shares []store.Share, why string) {
	ended := map[string]bool{}
	g.mu.Lock()
	for _, sh := range shares {
		if _, ok := g.shares[sh.ID]; !ok {
			continue // ended already
		}
		if err := g.opts.Store.DeleteShare(sh.ID); err != nil {
			g.opts.Log.Error().Err(err).Str("share", sh.ID).Msg("cannot delete a share")
		}
		delete(g.shares, sh.ID)
		delete(g.online, sh.ID)
		ended[sh.ID] = true
	}
	g.armExpiry()
	g.mu.Unlock()
	if len(ended) == 0 {
		return
	}
	ofEnded := func(provider, subject string) bool {
		id, _, _ := strings.Cut(subject, "/")
		return provider == collab.GuestProvider && ended[id]
	}
	g.opts.Sessions.EndSessions(func(identity auth.Identity) bool { return ofEnded(identity.Provider, identity.Subject) })
	g.opts.Rooms.Disconnect(func(p *collab.Peer) bool { return ofEnded(p.User().Provider, p.User().ID) }, ReasonEnded)
	rooms := map[string]bool{}
	for _, sh := range shares {
		if ended[sh.ID] {
			g.opts.Log.Info().Str("share", sh.ID).Str("room", sh.Room).Msg("share ended: " + why)
			rooms[sh.Room] = true
		}
	}
	for room := range rooms {
		g.opts.Rooms.BroadcastStateless(room, MsgChanged)
	}
}

// task runs fn as tracked work (Close waits for it); not at all once closed.
func (g *Guests) task(fn func()) {
	g.mu.Lock()
	if g.ctx.Err() != nil {
		g.mu.Unlock()
		return
	}
	g.tasks.Add(1)
	g.mu.Unlock()
	defer g.tasks.Done()
	fn()
}

// goTask runs fn as tracked work on a goroutine of its own.
func (g *Guests) goTask(fn func()) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.ctx.Err() != nil {
		return
	}
	g.tasks.Add(1)
	go func() {
		defer g.tasks.Done()
		fn()
	}()
}

func creatorOf(sh store.Share) collab.User {
	return collab.User{Provider: sh.CreatorProvider, ID: sh.CreatorID, Name: sh.CreatorName}
}

func userOf(identity auth.Identity) collab.User {
	return collab.User{Provider: identity.Provider, ID: identity.Subject, Name: identity.Name, Email: identity.Email}
}

// limiter counts joins per minute, per IP and in all.
type limiter struct {
	mu     sync.Mutex
	window time.Time
	inAll  int
	perIP  map[string]int
}

// allow counts a join from ip at now: false beyond joinsPerIP or joinsInAll in its minute.
func (l *limiter) allow(ip string, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if now.Sub(l.window) >= time.Minute {
		l.window, l.inAll = now, 0
		clear(l.perIP)
	}
	if l.inAll >= joinsInAll || l.perIP[ip] >= joinsPerIP {
		return false
	}
	l.inAll++
	l.perIP[ip]++
	return true
}

// clientIP is the address r came from (the connection's: behind a proxy, the proxy's).
func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func isJSON(r *http.Request) bool {
	t, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	return err == nil && t == "application/json"
}

// cleanText is s trimmed, its runs of white space as one space; false when that is empty, longer than limit
// characters, or holds a control character (bidirectional ones included: they would reorder what follows).
func cleanText(s string, limit int) (string, bool) {
	s = strings.Join(strings.Fields(s), " ")
	control := func(r rune) bool { return unicode.IsControl(r) || unicode.Is(unicode.Bidi_Control, r) }
	if s == "" || utf8.RuneCountInString(s) > limit || strings.ContainsFunc(s, control) {
		return "", false
	}
	return s, true
}

func reply(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
