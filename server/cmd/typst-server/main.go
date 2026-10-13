// Command typst-server is the collaboration server: `mise run server:dev`. It reads its settings from the
// environment (package config: GitLab rooms, plain rooms, the sign-in, the database) and serves the
// Hocuspocus protocol on ws://ADDRESS:PORT (any path), next to the HTTP endpoints of package app. On
// SIGINT/SIGTERM it stores every open room before exiting.
package main

import (
	"errors"
	"fmt"
	"net"
	"os"
	"strconv"
	"strings"

	"github.com/rs/zerolog"

	"typst-editor/server/lib/app"
	"typst-editor/server/lib/auth"
	"typst-editor/server/lib/config"
	"typst-editor/server/lib/gitlab"
	"typst-editor/server/lib/logging"
	"typst-editor/server/lib/store"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "typst-server:", err)
		os.Exit(1)
	}
}

func run() error {
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
		Store: st, Auth: signIn, PlainRooms: cfg.Rooms.Plain,
		GitLab: gitlabRooms, Log: log,
	})
	if err != nil {
		return err
	}
	log.Info().Str("db", cfg.Collab.DB).Str("issuer", cfg.Auth.Issuer).Bool("plainRooms", cfg.Rooms.Plain).
		Str("gitlab", cfg.GitLab.URL).Msg("collaboration server")
	return app.Run(log, server.Close, app.Site{
		Name: "collaboration server", Address: net.JoinHostPort(cfg.Address, strconv.Itoa(cfg.Port)), Handler: server,
	})
}

// signInWith is the sign-in cfg configures. With the GitLab instance as the issuer (the default), a user's
// subject is their GitLab user id: identities are GitLab's, which GitLab rooms check. Another issuer's
// identities are its own ("oidc"), which GitLab rooms refuse.
func signInWith(cfg config.Config, log zerolog.Logger) (*auth.Auth, error) {
	a := cfg.Auth
	if a.Issuer == "" || a.ClientID == "" || a.ClientSecret == "" {
		return nil, errors.New("sign-in is not configured: set TYPST_AUTH_CLIENT_ID and TYPST_AUTH_CLIENT_SECRET (an OAuth application on the GitLab instance; another provider with TYPST_AUTH_ISSUER)")
	}
	o := auth.Options{
		Provider: "oidc", Issuer: a.Issuer, ClientID: a.ClientID, ClientSecret: a.ClientSecret, RedirectURL: a.RedirectURL,
		Log: log.With().Str("module", "auth").Logger(),
	}
	if cfg.GitLab.URL != "" && strings.TrimSuffix(a.Issuer, "/") == strings.TrimSuffix(cfg.GitLab.URL, "/") {
		o.Provider = gitlab.DefaultID
		o.Scopes = []string{"openid", "profile", "email", "read_api"} // read_api: the project chooser, later
	}
	return auth.New(o), nil
}

// gitlabOptions are the GitLab rooms cfg configures (nil: none, without URL or token).
func gitlabOptions(cfg config.Config) (*gitlab.Options, error) {
	if cfg.GitLab.URL == "" || cfg.GitLab.Token == "" {
		return nil, nil
	}
	autoCommit, err := gitlab.ParseAutoCommit(cfg.GitLab.AutoCommit)
	if err != nil {
		return nil, err
	}
	return &gitlab.Options{
		URL: cfg.GitLab.URL, Token: cfg.GitLab.Token, WebhookSecret: cfg.GitLab.WebhookSecret,
		AuthorEmail: cfg.GitLab.AuthorEmail, AutoCommit: autoCommit,
	}, nil
}
