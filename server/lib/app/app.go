// Package app puts the collaboration server together on one port, for both commands (zwiebelfisch, and
// fake-gitlab for the demo): the rooms (package collab), GitLab rooms (package gitlab), the sign-in (package
// auth) and, when enabled, guest links (package guest).
//
// Routes follow one rule: /api/public/ is the only part anyone may call; everything else requires a
// signed-in user (requireSignIn: 401 otherwise, for a WebSocket before its upgrade). New lists every route. A
// CORS preflight is answered for any path (preflight).
//
// Who opens which room:
//   - a GitLab room (when configured): anyone signed in with GitLab whose role lets them edit
//   - any other room without a colon in its name (a plain room, only when enabled): anyone signed in
//   - a guest: the room of their share only
//
// Who may share a room with guests: who opens it, but a guest. A sign-out ends that session's open
// connections. A refused client is told why, in words the widget shows. GET /api/public/info tells clients
// beforehand whether plain rooms and guest links exist.
package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/rs/zerolog"

	"github.com/sandstorm/zwiebelfisch/server/lib/auth"
	"github.com/sandstorm/zwiebelfisch/server/lib/collab"
	"github.com/sandstorm/zwiebelfisch/server/lib/gitlab"
	"github.com/sandstorm/zwiebelfisch/server/lib/guest"
	"github.com/sandstorm/zwiebelfisch/server/lib/store"
)

// Options configure a Server. Store and Auth are required.
type Options struct {
	Store *store.Store
	// Auth is the sign-in: who sent a request.
	Auth *auth.Auth
	// PlainRooms enables rooms that are not GitLab rooms.
	PlainRooms bool
	// Guests enables guest links (package guest).
	Guests bool
	// GitLab enables GitLab rooms (nil: none). Its Authenticate, Token (Auth's) and Log are set here.
	GitLab *gitlab.Options
	Log    zerolog.Logger
}

// Server is the collaboration server as an http.Handler: the routes New lists. Close it after the HTTP
// server is shut down.
type Server struct {
	auth     *auth.Auth
	rooms    *collab.Server
	gitlab   *gitlab.Rooms // nil: no GitLab rooms
	guests   *guest.Guests // nil: no guest links
	plain    bool
	public   *routes // for anyone
	signedIn *routes // for signed-in users only
	mux      *http.ServeMux
}

// PublicPrefix is the only part of the server that answers without a sign-in.
const PublicPrefix = "/api/public/"

// New returns the server for o. A server with neither plain nor GitLab rooms would refuse everyone: an
// error.
func New(o Options) (*Server, error) {
	if !o.PlainRooms && o.GitLab == nil {
		return nil, errors.New("no rooms to serve: configure GitLab (ZWF_GITLAB_URL) or enable plain rooms (ZWF_PLAIN_ROOMS=1)")
	}
	if o.Auth == nil {
		return nil, errors.New("no sign-in: configure it (ZWF_AUTH_CLIENT_ID, ZWF_AUTH_CLIENT_SECRET)")
	}
	s := &Server{auth: o.Auth, plain: o.PlainRooms}
	var extension collab.Extension
	if o.GitLab != nil {
		g := *o.GitLab
		g.Authenticate, g.Token, g.Log = s.authenticate, o.Auth.Token, o.Log.With().Str("module", "gitlab").Logger()
		s.gitlab = gitlab.New(g)
		extension = s.gitlab
	}
	collabOptions := collab.Options{
		Store: o.Store, Authenticate: s.authenticate, Extension: extension,
		Log: o.Log.With().Str("module", "collab").Logger(),
	}
	if o.Guests {
		collabOptions.PeerChanged = func(room string, user collab.User, joined bool) {
			if user.IsGuest() {
				s.guests.PeerChanged(room, user, joined)
			}
		}
	}
	s.rooms = collab.New(collabOptions)
	if o.Guests {
		guests, err := guest.New(guest.Options{
			Store: o.Store, Sessions: o.Auth, Rooms: s.rooms, MayShare: s.mayShare,
			Log: o.Log.With().Str("module", "guest").Logger(),
		})
		if err != nil {
			_ = s.rooms.Close(context.Background())
			if s.gitlab != nil {
				s.gitlab.Close()
			}
			return nil, err
		}
		s.guests = guests
	}

	public := newRoutes(PublicPrefix)
	public.HandleFunc("GET /api/public/auth/login", o.Auth.Login)       // signing in begins signed out
	public.HandleFunc("GET /api/public/auth/callback", o.Auth.Callback) // the identity provider sends the browser back here
	public.HandleFunc("GET /api/public/info", s.info)                   // what this server offers, read before signing in
	if s.gitlab != nil && o.GitLab.WebhookSecret != "" {
		public.HandleFunc("POST /api/public/gitlab/webhook", s.gitlab.ServeWebhook) // GitLab calls it, with X-Gitlab-Token
	}
	if s.guests != nil {
		public.HandleFunc("POST /api/public/guest/join", s.guests.Join) // a guest link's page signs its guest in
	}

	signedIn := newRoutes("/api/")
	signedIn.Handle("GET /api/collaboration", s.rooms) // the WebSocket (COLLABORATION_PATH in src/extensions/collaboration/room-protocol.ts)
	signedIn.HandleFunc("GET /api/me", o.Auth.Me)
	signedIn.HandleFunc("POST /api/auth/logout", s.logout(o.Auth))
	if s.gitlab != nil {
		signedIn.HandleFunc("GET /api/rooms/{room}/files/{path...}", s.gitlab.ServeFile)
		signedIn.HandleFunc("GET /api/rooms/{room}/history", s.gitlab.ServeHistory)
		signedIn.HandleFunc("GET /api/rooms/{room}/compare", s.gitlab.ServeCompare)
	}
	if s.guests != nil {
		signedIn.HandleFunc("POST /api/rooms/{room}/shares", s.guests.Create)
		signedIn.HandleFunc("GET /api/rooms/{room}/shares", s.guests.List)
		signedIn.HandleFunc("DELETE /api/rooms/{room}/shares/{id}", s.guests.Revoke)
	}

	s.public, s.signedIn, s.mux = public, signedIn, http.NewServeMux()
	s.mux.Handle(PublicPrefix, public)
	s.mux.Handle("/", requireSignIn(o.Auth, signedIn)) // unknown paths too: 401 signed out, 404 signed in
	return s, nil
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions && r.Header.Get("Access-Control-Request-Method") != "" {
		preflight(w, r)
		return
	}
	s.mux.ServeHTTP(w, r)
}

// preflight answers a browser's CORS preflight for any path: a page of this host on another port (the widget's)
// may send JSON bodies and DELETEs with the cookie; another site's page is permitted nothing.
func preflight(w http.ResponseWriter, r *http.Request) {
	auth.AllowCredentials(w, r)
	if w.Header().Get("Access-Control-Allow-Origin") != "" {
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.Header().Set("Access-Control-Max-Age", "600")
	}
	w.WriteHeader(http.StatusNoContent)
}

// requireSignIn lets only signed-in clients through to next, their identity in the request (auth.SignedIn);
// others get 401. The answers carry CORS with credentials: the widget, on another port of this host, sends
// the cookie and reads them (a 401 too: signed out).
func requireSignIn(a *auth.Auth, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth.AllowCredentials(w, r)
		identity, ok := a.Identify(r)
		if !ok {
			http.Error(w, "Not signed in", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, auth.WithIdentity(r, identity))
	})
}

// routes is an http.ServeMux that takes only patterns under its prefix (New panics on a route in the wrong
// part) and remembers them, for the tests to try each.
type routes struct {
	*http.ServeMux
	prefix   string
	patterns []string
}

func newRoutes(prefix string) *routes { return &routes{ServeMux: http.NewServeMux(), prefix: prefix} }

func (rs *routes) Handle(pattern string, h http.Handler) {
	if _, path, _ := strings.Cut(pattern, " "); !strings.HasPrefix(path, rs.prefix) {
		panic(fmt.Sprintf("app: route %q is outside %s", pattern, rs.prefix))
	}
	rs.patterns = append(rs.patterns, pattern)
	rs.ServeMux.Handle(pattern, h)
}

func (rs *routes) HandleFunc(pattern string, h func(http.ResponseWriter, *http.Request)) {
	rs.Handle(pattern, http.HandlerFunc(h))
}

// logout signs out (auth's Logout), after the GitLab rooms committed what the user has not committed yet
// (while their token still works); then the user's clients whose connection that session opened are refused.
func (s *Server) logout(a *auth.Auth) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		identity, ok := auth.SignedIn(r)
		if ok && s.gitlab != nil && !userOf(identity).IsGuest() { // a guest's edits wait for a member's save
			s.gitlab.SignedOut(userOf(identity))
		}
		a.Logout(w, r)
		if !ok {
			return
		}
		s.rooms.Disconnect(func(p *collab.Peer) bool {
			if u := p.User(); u.Provider != identity.Provider || u.ID != identity.Subject {
				return false
			}
			_, still := a.Identify(p.Request())
			return !still
		}, signedOut)
	}
}

func userOf(identity auth.Identity) collab.User {
	return collab.User{Provider: identity.Provider, ID: identity.Subject, Name: identity.Name, Email: identity.Email}
}

// GitLab are the GitLab rooms (nil: none), for the demo playground's endpoints.
func (s *Server) GitLab() *gitlab.Rooms { return s.gitlab }

// Info is what GET /api/public/info answers: what this server offers, for clients to choose from.
type Info struct {
	PlainRooms bool `json:"plainRooms"`
	Guests     bool `json:"guests"`
}

func (s *Server) info(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(Info{PlainRooms: s.plain, Guests: s.guests != nil})
}

// signedOut refuses a client whose session ended (signed out, expired) in the rooms it has open or opens.
const signedOut = "You signed out."

// authenticate decides who opens room, for a request requireSignIn let through, while its session lasts
// (signedOut after): the room must exist here, and for a GitLab room the user have a role that edits; a
// guest opens their share's room only. A plain room's name has no colon: `<id>:` names belong to room
// providers (gitlab:), so a plain room never shares a stored state with theirs.
func (s *Server) authenticate(r *http.Request, room string) (collab.User, error) {
	if _, ok := auth.SignedIn(r); !ok {
		return collab.User{}, errors.New("not signed in") // not behind requireSignIn: a bug
	}
	identity, ok := s.auth.Identify(r) // afresh: a connection opens rooms long after its upgrade
	if !ok {
		return collab.User{}, collab.Refusal{Reason: signedOut}
	}
	if user := userOf(identity); user.IsGuest() {
		if s.guests == nil {
			return collab.User{}, collab.Refusal{Reason: guest.ReasonEnded}
		}
		return user, s.guests.Authorize(user, room)
	}
	isGitLab := s.gitlab != nil && s.gitlab.Handles(room)
	switch {
	case isGitLab:
	case !s.plain:
		return collab.User{}, collab.Refusal{Reason: fmt.Sprintf(
			"This server opens only GitLab rooms (gitlab:<project>@<branch>), not %q.", room)}
	case strings.Contains(room, ":"):
		return collab.User{}, collab.Refusal{Reason: fmt.Sprintf(
			"Room names with a colon are not plain rooms, and this server opens no %q.", room)}
	}
	user := userOf(identity)
	if isGitLab {
		if err := s.gitlab.Authorize(r.Context(), user, room); err != nil {
			return collab.User{}, err
		}
	}
	return user, nil
}

// mayShare is whether user may share room with guests (guest.Options.MayShare): a GitLab room if GitLab says
// they may edit it, a plain room if they are signed in; never a guest.
func (s *Server) mayShare(ctx context.Context, user collab.User, room string) (bool, error) {
	switch {
	case user.IsGuest() || user.ID == "":
		return false, nil
	case s.gitlab != nil && s.gitlab.Handles(room):
		return s.gitlab.MayEdit(ctx, user, room)
	}
	return s.plain && !strings.Contains(room, ":"), nil
}

// Close ends the guest links' work, stores the open rooms and ends the GitLab rooms' work (or gives up when
// ctx ends).
func (s *Server) Close(ctx context.Context) error {
	if s.guests != nil {
		s.guests.Close()
	}
	err := s.rooms.Close(ctx)
	if s.gitlab != nil {
		s.gitlab.Close()
	}
	return err
}

// Site is a handler to serve on an address ("host:port"); Name says what it is in the log.
type Site struct {
	Name    string
	Address string
	Handler http.Handler
}

// Run serves the sites until SIGINT or SIGTERM (or until one fails), then shuts them down and calls
// done (Server.Close), so the rooms are stored before the process exits.
func Run(log zerolog.Logger, done func(context.Context) error, sites ...Site) error {
	stop, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	servers := make([]*http.Server, 0, len(sites))
	served := make(chan error, len(sites))
	for _, site := range sites {
		listener, err := net.Listen("tcp", site.Address)
		if err != nil {
			return errors.Join(err, shutdown(servers), done(context.Background()))
		}
		server := newHTTPServer(site.Handler)
		servers = append(servers, server)
		go func() { served <- server.Serve(listener) }()
		log.Info().Msgf("%s on %s", site.Name, listener.Addr())
	}

	var failed error
	select {
	case failed = <-served:
	case <-stop.Done():
		log.Info().Msg("shutting down: storing open rooms")
	}
	ctx, end := context.WithTimeout(context.Background(), 10*time.Second)
	defer end()
	// Shutdown stops accepting; the WebSockets (hijacked, so not waited for) end in done.
	return errors.Join(failed, shutdown(servers), done(ctx))
}

// newHTTPServer serves h, for Run: a client gets 10 s for its headers (at most 64 KiB) and 30 s for its
// whole request, and an idle keep-alive connection closes after 2 min. A WebSocket, once upgraded, is not
// bound by these (collab pings it instead).
func newHTTPServer(h http.Handler) *http.Server {
	return &http.Server{
		Handler: h, ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 30 * time.Second,
		IdleTimeout: 2 * time.Minute, MaxHeaderBytes: 64 << 10,
	}
}

func shutdown(servers []*http.Server) error {
	ctx, end := context.WithTimeout(context.Background(), 5*time.Second)
	defer end()
	var errs []error
	for _, s := range servers {
		if err := s.Shutdown(ctx); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}
