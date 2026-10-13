// Command typst-server is the collaboration server in Go: `mise run server:go:dev`. It reads the same
// environment as the TypeScript server (server/src/main.ts, see package config) and serves the Hocuspocus
// protocol on ws://ADDRESS:PORT (any path). On SIGINT/SIGTERM it stores every open room before exiting.
//
// Not yet here (the TypeScript server still has them): GitLab-backed rooms and the room files endpoint.
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

	"typst-editor/server/lib/collab"
	"typst-editor/server/lib/config"
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
	st, err := store.Open(cfg.Collab.DB)
	if err != nil {
		return err
	}
	defer st.Close()
	rooms := collab.New(collab.Options{
		Store:        st,
		Authenticate: collab.SharedToken(cfg.Collab.Token),
		Log:          log.With().Str("module", "collab").Logger(),
	})

	listener, err := net.Listen("tcp", net.JoinHostPort(cfg.Address, strconv.Itoa(cfg.Port)))
	if err != nil {
		return err
	}
	server := &http.Server{Handler: rooms, ReadHeaderTimeout: 10 * time.Second}
	served := make(chan error, 1)
	go func() { served <- server.Serve(listener) }()
	log.Info().Str("db", cfg.Collab.DB).Bool("token", cfg.Collab.Token != "").
		Msgf("collaboration server on ws://%s", listener.Addr())

	stop, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	select {
	case err := <-served:
		return err
	case <-stop.Done():
	}
	log.Info().Msg("shutting down: storing open rooms")
	ctx, done := context.WithTimeout(context.Background(), 10*time.Second)
	defer done()
	// Shutdown stops accepting; the WebSockets (hijacked, so not waited for) end in rooms.Close.
	if err := server.Shutdown(ctx); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return rooms.Close(ctx)
}
