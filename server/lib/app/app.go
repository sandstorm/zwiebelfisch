// Package app puts the collaboration server together, for both commands (typst-server, and fake-gitlab for
// the demo): the rooms (package collab) with GitLab rooms (package gitlab) as their extension, the sign-in
// (package auth), and the HTTP endpoints next to the WebSocket, on one port.
//
// It also decides who opens which room. GitLab rooms always (when configured), for people signed in whose
// GitLab role lets them edit (gitlab.Rooms.Authorize); plain rooms (any other name) only when enabled, for
// anyone signed in: their content lives in nothing but the server's database, and the product leads people
// to GitLab branches. A refused client is told why, in words the widget shows (sign in first, only GitLab
// rooms here, your role). GET /api/info tells clients beforehand which rooms exist, so the demo offers only
// what works.
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
	"syscall"
	"time"

	"github.com/rs/zerolog"

	"typst-editor/server/lib/auth"
	"typst-editor/server/lib/collab"
	"typst-editor/server/lib/gitlab"
)

// SignInRequired is the reason a client that is not signed in is refused (SIGN_IN_REQUIRED in
// src/core/room-protocol/room-protocol.ts: the widget offers to sign in).
const SignInRequired = "Sign in to join this room."

// Options configure a Server. Store and Auth are required.
type Options struct {
	Store collab.Store
	// Auth is the sign-in: who sent a request.
	Auth *auth.Auth
	// PlainRooms enables rooms that are not GitLab rooms.
	PlainRooms bool
	// GitLab enables GitLab rooms (nil: none). Its Authenticate and Log are set here.
	GitLab *gitlab.Options
	Log    zerolog.Logger
}

// Server is the collaboration server as an http.Handler: the WebSocket (any path), GET /api/info, the
// sign-in (/auth/…, /api/me) and the GitLab rooms' endpoints (room files, webhook). Close it after the HTTP
// server is shut down.
type Server struct {
	rooms  *collab.Server
	gitlab *gitlab.Rooms // nil: no GitLab rooms
	plain  bool
	auth   *auth.Auth
	mux    *http.ServeMux
}

// New returns the server for o. A server with neither plain nor GitLab rooms would refuse everyone: an
// error.
func New(o Options) (*Server, error) {
	if !o.PlainRooms && o.GitLab == nil {
		return nil, errors.New("no rooms to serve: configure GitLab (TYPST_GITLAB_URL, TYPST_GITLAB_TOKEN) or enable plain rooms (TYPST_PLAIN_ROOMS=1)")
	}
	if o.Auth == nil {
		return nil, errors.New("no sign-in: configure it (TYPST_AUTH_CLIENT_ID, TYPST_AUTH_CLIENT_SECRET)")
	}
	s := &Server{plain: o.PlainRooms, auth: o.Auth, mux: http.NewServeMux()}
	var extension collab.Extension
	if o.GitLab != nil {
		g := *o.GitLab
		g.Authenticate, g.Log = s.authenticate, o.Log.With().Str("module", "gitlab").Logger()
		s.gitlab = gitlab.New(g)
		extension = s.gitlab
		files := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			auth.AllowCredentials(w, r) // the widget fetches room files with the cookie
			s.gitlab.ServeHTTP(w, r)
		})
		for _, path := range s.gitlab.Paths() {
			s.mux.Handle(path, files)
		}
	}
	for _, path := range o.Auth.Paths() {
		s.mux.Handle(path, o.Auth)
	}
	s.rooms = collab.New(collab.Options{
		Store: o.Store, Authenticate: s.authenticate, Extension: extension,
		Log: o.Log.With().Str("module", "collab").Logger(),
	})
	s.mux.HandleFunc("GET /api/info", s.info)
	s.mux.Handle("/", s.rooms)
	return s, nil
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) { s.mux.ServeHTTP(w, r) }

// GitLab are the GitLab rooms (nil: none), for the demo playground's endpoints.
func (s *Server) GitLab() *gitlab.Rooms { return s.gitlab }

// Info is what GET /api/info answers: what this server offers, for clients to choose from.
type Info struct {
	PlainRooms bool `json:"plainRooms"`
}

func (s *Server) info(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(Info{PlainRooms: s.plain})
}

// authenticate decides who opens room: the room must exist here, the client be signed in, and for a GitLab
// room have a role that edits.
func (s *Server) authenticate(r *http.Request, room string) (collab.User, error) {
	isGitLab := s.gitlab != nil && s.gitlab.Handles(room)
	if !s.plain && !isGitLab {
		return collab.User{}, collab.Refusal{Reason: fmt.Sprintf(
			"This server opens only GitLab rooms (gitlab:<project>@<branch>), not %q.", room)}
	}
	identity, ok := s.auth.Identify(r)
	if !ok {
		return collab.User{}, collab.Refusal{Reason: SignInRequired}
	}
	user := collab.User{Provider: identity.Provider, ID: identity.Subject, Name: identity.Name, Email: identity.Email}
	if isGitLab {
		if err := s.gitlab.Authorize(r.Context(), user, room); err != nil {
			return collab.User{}, err
		}
	}
	return user, nil
}

// Close stores the open rooms and ends the GitLab rooms' work (or gives up when ctx ends).
func (s *Server) Close(ctx context.Context) error {
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
		server := &http.Server{Handler: site.Handler, ReadHeaderTimeout: 10 * time.Second}
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
