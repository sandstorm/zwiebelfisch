// Command fake-gitlab is the demo playground's server (`mise run demo`, `server:dev-fake-gitlab`,
// `test:e2e-gitlab`, the Docker image): the collaboration server with GitLab rooms against an in-memory fake
// GitLab, whose project demo/report holds the demo's advanced example (template, chapters, images), plus
// the playground endpoints (package playground). People sign in at the fake GitLab (its page is
// /oauth/authorize here: any name, no password; everyone is a Developer). No real GitLab, no secrets,
// nothing stored. Any branch works: gitlab:demo/report@<branch> starts at main. Run it from the repository
// root (it reads demo/examples/advanced).
//
// Environment: as package config (PORT, TYPST_ADDRESS, TYPST_PLAIN_ROOMS, TYPST_GITLAB_AUTO_COMMIT,
// TYPST_LOG_*; the database, the sign-in's and the real GitLab's settings are ignored: rooms live in
// memory, the fake GitLab signs people in), and
//
//	TYPST_DEMO_DIST  (default unset) a built demo (dist/demo) to serve on DEMO_PORT (default 5199), where Vite
//	                 would serve it (playground.StaticFiles)
package main

import (
	"crypto/rand"
	"fmt"
	"net"
	"os"
	"strconv"

	"typst-editor/server/lib/app"
	"typst-editor/server/lib/auth"
	"typst-editor/server/lib/config"
	"typst-editor/server/lib/fakegitlab"
	"typst-editor/server/lib/gitlab"
	"typst-editor/server/lib/logging"
	"typst-editor/server/lib/playground"
	"typst-editor/server/lib/store"
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
			URL: fakegitlab.URL, Token: fakegitlab.Token, Client: fake.Client(),
			WebhookSecret: webhookSecret, AutoCommit: autoCommit,
		},
	})
	if err != nil {
		return err
	}
	// simulated pushes go to the server's webhook, so open rooms merge them right away
	handler := playground.Handler(playground.Options{
		GitLab: fake, AppendTo: "/chapters/introduction.typ", Webhook: server, WebhookSecret: webhookSecret,
	}, server)

	log.Info().Str("room", playground.Room).Bool("plainRooms", cfg.Rooms.Plain).Msg("playground server with the fake GitLab")
	sites := []app.Site{{Name: "collaboration server", Address: net.JoinHostPort(cfg.Address, strconv.Itoa(cfg.Port)), Handler: handler}}
	if dist := os.Getenv("TYPST_DEMO_DIST"); dist != "" {
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
