package main

import (
	"errors"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/rs/zerolog"

	"github.com/sandstorm/zwiebelfisch/server/lib/app"
	"github.com/sandstorm/zwiebelfisch/server/lib/auth"
	"github.com/sandstorm/zwiebelfisch/server/lib/config"
	"github.com/sandstorm/zwiebelfisch/server/lib/gitlab"
	"github.com/sandstorm/zwiebelfisch/server/lib/logging"
	"github.com/sandstorm/zwiebelfisch/server/lib/store"
	"github.com/sandstorm/zwiebelfisch/server/lib/webapp"
)

// serve is `zwiebelfisch serve`: the collaboration server, with the app on every path but /api/.
func serve() error {
	cfg, err := config.Load(os.Environ())
	if err != nil {
		return err
	}
	log, err := logging.New(os.Stderr, cfg.Log.Format, cfg.Log.Level)
	if err != nil {
		return err
	}
	gitlabRooms, err := gitlabOptions(cfg)
	if err != nil {
		return err
	}
	signIn, err := signInWith(cfg, log)
	if err != nil {
		return err
	}
	st, err := store.Open(cfg.Collab.DB)
	if err != nil {
		return err
	}
	defer st.Close()
	server, err := app.New(app.Options{
		Store: st, Auth: signIn, PlainRooms: cfg.Rooms.Plain, Guests: cfg.Rooms.Guests,
		GitLab: gitlabRooms, Log: log,
	})
	if err != nil {
		return err
	}
	log.Info().Strs("allowedOrigins", cfg.AllowedOrigins).Str("db", cfg.Collab.DB).Str("issuer", cfg.Auth.Issuer).Bool("plainRooms", cfg.Rooms.Plain).Bool("guests", cfg.Rooms.Guests).
		Str("gitlab", cfg.GitLab.URL).Msg("collaboration server")
	var handler http.Handler = server
	if files, err := webapp.Files(); err != nil {
		log.Warn().Err(err).Msg("serving the API only")
	} else {
		handler = app.WithStaticFiles(server, files)
	}
	return app.Run(log, server.Close, app.Site{
		Name: "collaboration server", Address: net.JoinHostPort(cfg.Address, strconv.Itoa(cfg.Port)), Handler: handler,
	})
}

// signInWith is the sign-in cfg configures. With the GitLab instance as the issuer (the default), a user's
// subject is their GitLab user id: identities are GitLab's, which GitLab rooms check. Another issuer's
// identities are its own ("oidc"), which GitLab rooms refuse.
func signInWith(cfg config.Config, log zerolog.Logger) (*auth.Auth, error) {
	a := cfg.Auth
	if a.Issuer == "" || a.ClientID == "" || a.ClientSecret == "" {
		return nil, errors.New("sign-in is not configured: set ZWF_AUTH_CLIENT_ID and ZWF_AUTH_CLIENT_SECRET (an OAuth application on the GitLab instance; another provider with ZWF_AUTH_ISSUER)")
	}
	o := auth.Options{
		Provider: "oidc", Issuer: a.Issuer, ClientID: a.ClientID, ClientSecret: a.ClientSecret, RedirectURL: a.RedirectURL,
		AllowedOrigins: cfg.AllowedOrigins, Log: log.With().Str("module", "auth").Logger(),
	}
	if cfg.GitLab.URL != "" && strings.TrimSuffix(a.Issuer, "/") == strings.TrimSuffix(cfg.GitLab.URL, "/") {
		o.Provider = gitlab.DefaultID
		// read_api: who may edit and push; write_repository: fetch and push (git over HTTP)
		o.Scopes = []string{"openid", "profile", "email", "read_api", "write_repository"}
	}
	return auth.New(o), nil
}

// gitlabOptions are the GitLab rooms cfg configures (nil: none, without URL). The git clones go next to the
// database (in memory with it).
func gitlabOptions(cfg config.Config) (*gitlab.Options, error) {
	if cfg.GitLab.URL == "" {
		return nil, nil
	}
	autoCommit, err := gitlab.ParseAutoCommit(cfg.GitLab.AutoCommit)
	if err != nil {
		return nil, err
	}
	dir := ""
	if cfg.Collab.DB != store.Memory {
		dir = filepath.Join(filepath.Dir(cfg.Collab.DB), "repositories")
	}
	return &gitlab.Options{
		URL: cfg.GitLab.URL, Dir: dir, WebhookSecret: cfg.GitLab.WebhookSecret,
		AuthorEmail: cfg.GitLab.AuthorEmail, AutoCommit: autoCommit,
	}, nil
}
