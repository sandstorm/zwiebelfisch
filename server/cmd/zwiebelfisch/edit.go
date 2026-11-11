package main

import (
	"context"
	"crypto/rand"
	"fmt"
	"net"
	"os"
	"os/exec"
	"runtime"
	"time"

	"github.com/sandstorm/zwiebelfisch/server/lib/app"
	"github.com/sandstorm/zwiebelfisch/server/lib/local"
	"github.com/sandstorm/zwiebelfisch/server/lib/logging"
	"github.com/sandstorm/zwiebelfisch/server/lib/webapp"
)

// edit is `zwiebelfisch [path]`: the local editor for target on a free port of 127.0.0.1, opened in the browser
// (with browser), until SIGINT or SIGTERM. Disk is read for changes every second.
func edit(target string, browser bool) error {
	files, err := webapp.Files()
	if err != nil {
		return err
	}
	folder, err := local.Open(target)
	if err != nil {
		return err
	}
	defer folder.Close()
	log, err := logging.New(os.Stderr, "console", "info")
	if err != nil {
		return err
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}
	token := rand.Text()
	url := fmt.Sprintf("http://%s/local#%s", listener.Addr(), token)
	fmt.Fprintf(os.Stderr, "Zwiebelfisch: %s (main file %s) on %s\nCtrl-C to stop.\n", folder.Dir(), folder.Main(), url)

	go func() {
		for tick := time.NewTicker(time.Second); ; {
			select {
			case <-folder.Closed():
				tick.Stop()
				return
			case <-tick.C:
				if err := folder.Poll(); err != nil {
					log.Warn().Err(err).Msg("reading the folder")
				}
			}
		}
	}()
	if browser {
		if err := openBrowser(url); err != nil {
			log.Warn().Err(err).Msg("open the address above yourself")
		}
	}
	return app.Run(log, func(context.Context) error { return nil }, app.Site{
		Name: "local editor", Listener: listener, Handler: app.WithStaticFiles(local.Handler(folder, token), files),
		OnShutdown: func() { _ = folder.Close() }, // ends the pages' event streams
	})
}

// openBrowser opens url in the default browser (macOS: open, Linux: xdg-open, Windows: rundll32).
func openBrowser(url string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	go func() { _ = cmd.Wait() }()
	return nil
}
