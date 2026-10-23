// Command fake-gitlab is the demo playground's server: the collaboration server with GitLab rooms against an
// in-memory fake GitLab, plus the playground endpoints (package playground). Used by:
//   - `mise run demo` and `server:dev-fake-gitlab`
//   - `test:e2e-gitlab`
//   - the Docker image
//
// The fake project demo/report holds demo/examples/advanced, so run it from the repository root. Anyone signs
// in under any name, without a password, as a Developer; what the server does in GitLab it does with their
// token. Nothing is stored (the git clones are in memory too). Any branch works:
// gitlab:demo/report@<branch> starts at main.
//
// Environment: as package config, except that the database, sign-in and GitLab settings are ignored, and
//
//	ZWF_DEMO_DIST  (default unset) a built demo (dist/demo) to serve on DEMO_PORT (default 5199)
package main

import (
	"crypto/rand"
	"fmt"
	"net"
	"os"
	"strconv"

	"github.com/sandstorm/zwiebelfisch/server/lib/app"
	"github.com/sandstorm/zwiebelfisch/server/lib/auth"
	"github.com/sandstorm/zwiebelfisch/server/lib/config"
	"github.com/sandstorm/zwiebelfisch/server/lib/fakegitlab"
	"github.com/sandstorm/zwiebelfisch/server/lib/gitlab"
	"github.com/sandstorm/zwiebelfisch/server/lib/logging"
	"github.com/sandstorm/zwiebelfisch/server/lib/playground"
	"github.com/sandstorm/zwiebelfisch/server/lib/store"
)

const projectDir = "demo/examples/advanced"

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "fake-gitlab:", err)
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
	autoCommit, err := gitlab.ParseAutoCommit(cfg.GitLab.AutoCommit)
	if err != nil {
		return err
	}
	files, err := playground.ReadProjectFiles(projectDir)
	if err != nil || len(files) == 0 {
		return fmt.Errorf("the fake repository's files: run from the repository root (%s): %v", projectDir, err)
	}
	fake := fakegitlab.New(playground.Project, files)
	fake.SetAutoBranches(true)

	st, err := store.Open(store.Memory)
	if err != nil {
		return err
	}
	defer st.Close()
	webhookSecret := rand.Text()
	server, err := app.New(app.Options{
		Store: st, PlainRooms: cfg.Rooms.Plain, Log: log,
		Auth: auth.New(auth.Options{
			Provider: gitlab.DefaultID, Issuer: fakegitlab.URL, ClientID: fakegitlab.ClientID,
			ClientSecret: fakegitlab.ClientSecret, Client: fake.Client(), Log: log.With().Str("module", "auth").Logger(),
		}),
		GitLab: &gitlab.Options{
			URL: fakegitlab.URL, Client: fake.Client(), WebhookSecret: webhookSecret, AutoCommit: autoCommit,
		},
	})
	if err != nil {
		return err
	}
	// simulated pushes go to the server's webhook, so open rooms merge them right away
	handler := playground.Handler(playground.Options{
		GitLab: fake, AppendTo: "/chapters/introduction.typ", Webhook: server, WebhookSecret: webhookSecret,
		Rooms: server.GitLab(),
	}, server)

	log.Info().Str("room", playground.Room).Bool("plainRooms", cfg.Rooms.Plain).Msg("playground server with the fake GitLab")
	sites := []app.Site{{Name: "collaboration server", Address: net.JoinHostPort(cfg.Address, strconv.Itoa(cfg.Port)), Handler: handler}}
	if dist := os.Getenv("ZWF_DEMO_DIST"); dist != "" {
		port, err := strconv.Atoi(envOr("DEMO_PORT", "5199"))
		if err != nil {
			return fmt.Errorf("DEMO_PORT: %w", err)
		}
		// the page expects the server on 127.0.0.1 (demo/playground.ts): open the demo there
		sites = append(sites, app.Site{
			Name:    "demo (" + dist + ", open http://127.0.0.1:" + strconv.Itoa(port) + "/)",
			Address: net.JoinHostPort(cfg.Address, strconv.Itoa(port)), Handler: playground.StaticFiles(dist),
		})
	}
	return app.Run(log, server.Close, sites...)
}

func envOr(name, fallback string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return fallback
}
