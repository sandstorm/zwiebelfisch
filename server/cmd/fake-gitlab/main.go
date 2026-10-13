// Command fake-gitlab is the demo playground's server (today's server/src/fake-gitlab-main.ts, until the
// cut-over points `mise run demo`, `server:dev-fake-gitlab`, `test:e2e-gitlab` and the Docker image here):
// the collaboration server with an in-memory fake GitLab whose project demo/report holds the demo's advanced
// example (template, chapters, images), plus the playground endpoints. No real GitLab, no secrets, nothing
// stored. Any branch works: gitlab:demo/report@<branch> starts at main. Run it from the repository root
// (it reads demo/examples/advanced).
//
// Environment: as package config (PORT, TYPST_ADDRESS, TYPST_LOG_*; TYPST_COLLAB_DB and TYPST_COLLAB_TOKEN
// are ignored: rooms live in memory, anyone may open them), and
//
//	TYPST_DEMO_DIST  (default unset) a built demo (dist/demo) to serve on DEMO_PORT (default 5199), where Vite
//	                 would serve it (playground.StaticFiles)
//
// Not yet here: GitLab rooms (package gitlab). Once it exists, it gets the fake's Client and URL, and its
// push webhook goes into playground.Options, so simulated pushes merge into the open rooms.
package main

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/rs/zerolog"

	"typst-editor/server/lib/collab"
	"typst-editor/server/lib/config"
	"typst-editor/server/lib/fakegitlab"
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
	files, err := playground.ReadProjectFiles(projectDir)
	if err != nil || len(files) == 0 {
		return fmt.Errorf("the fake repository's files: run from the repository root (%s): %v", projectDir, err)
	}
	gitlab := fakegitlab.New(playground.Project, files)
	gitlab.SetAutoBranches(true)

	st, err := store.Open(store.Memory)
	if err != nil {
		return err
	}
	defer st.Close()
	rooms := collab.New(collab.Options{
		Store:        st,
		Authenticate: collab.SharedToken(nil),
		Log:          log.With().Str("module", "collab").Logger(),
	})
	handler := playground.Handler(playground.Options{GitLab: gitlab, AppendTo: "/chapters/introduction.typ"}, rooms)

	servers := []*http.Server{}
	served := make(chan error, 2)
	serve := func(port int, h http.Handler) error {
		listener, err := net.Listen("tcp", net.JoinHostPort(cfg.Address, strconv.Itoa(port)))
		if err != nil {
			return err
		}
		server := &http.Server{Handler: h, ReadHeaderTimeout: 10 * time.Second}
		servers = append(servers, server)
		go func() { served <- server.Serve(listener) }()
		return nil
	}
	if err := serve(cfg.Port, handler); err != nil {
		return err
	}
	log.Info().Str("room", playground.Room).Msgf("playground server on ws://127.0.0.1:%d with the fake GitLab", cfg.Port)
	if dist := os.Getenv("TYPST_DEMO_DIST"); dist != "" {
		port, err := strconv.Atoi(envOr("DEMO_PORT", "5199"))
		if err != nil {
			return fmt.Errorf("DEMO_PORT: %w", err)
		}
		// the page expects the server on 127.0.0.1 (demo/playground.ts), so that is the address to open
		if err := serve(port, playground.StaticFiles(dist)); err != nil {
			return err
		}
		log.Info().Str("dist", dist).Msgf("demo on http://127.0.0.1:%d/", port)
	}

	stop, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	select {
	case err := <-served:
		return err
	case <-stop.Done():
	}
	return shutdown(log, servers, rooms)
}

func shutdown(log zerolog.Logger, servers []*http.Server, rooms *collab.Server) error {
	log.Info().Msg("shutting down")
	ctx, done := context.WithTimeout(context.Background(), 5*time.Second)
	defer done()
	for _, s := range servers {
		if err := s.Shutdown(ctx); err != nil && !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	}
	return rooms.Close(ctx)
}

func envOr(name, fallback string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return fallback
}
