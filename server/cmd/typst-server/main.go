// Command typst-server is the collaboration server: `mise run server:dev`. It reads its settings from the
// environment (package config: GitLab rooms, plain rooms, the database, the token) and serves the
// Hocuspocus protocol on ws://ADDRESS:PORT (any path), next to the HTTP endpoints of package app. On
// SIGINT/SIGTERM it stores every open room before exiting.
package main

import (
	"fmt"
	"net"
	"os"
	"strconv"

	"typst-editor/server/lib/app"
	"typst-editor/server/lib/collab"
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
	st, err := store.Open(cfg.Collab.DB)
	if err != nil {
		return err
	}
	defer st.Close()
	server, err := app.New(app.Options{
		Store: st, Authenticate: collab.SharedToken(cfg.Collab.Token), PlainRooms: cfg.Rooms.Plain,
		GitLab: gitlabRooms, Log: log,
	})
	if err != nil {
		return err
	}
	log.Info().Str("db", cfg.Collab.DB).Bool("token", cfg.Collab.Token != nil).Bool("plainRooms", cfg.Rooms.Plain).
		Str("gitlab", cfg.GitLab.URL).Msg("collaboration server")
	return app.Run(log, server.Close, app.Site{
		Name: "collaboration server", Address: net.JoinHostPort(cfg.Address, strconv.Itoa(cfg.Port)), Handler: server,
	})
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
