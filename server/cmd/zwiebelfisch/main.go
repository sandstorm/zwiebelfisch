// Command zwiebelfisch is the editor for a folder on this machine, and the collaboration server.
//
//	zwiebelfisch [file or folder]   the local editor (package local) in the browser; "." without one
//	zwiebelfisch serve              the collaboration server (`mise run server:dev`)
//
// The local editor writes every change straight to the folder's files and shows changes made on disk; it serves
// on a free port of 127.0.0.1 until Ctrl-C. The collaboration server reads its settings from the environment
// (package config) and serves on ADDRESS:PORT; it does not start without ZWF_ALLOWED_ORIGINS, or with an
// invalid one:
//   - the Hocuspocus protocol (a WebSocket at /api/collaboration)
//   - the HTTP endpoints of package app
//   - the built app (package webapp: the start page, the editor at /edit) on every other path
//
// On SIGINT/SIGTERM it stores every open room before exiting.
package main

import (
	"flag"
	"fmt"
	"os"
)

func main() {
	flags := flag.NewFlagSet("zwiebelfisch", flag.ExitOnError)
	noBrowser := flags.Bool("no-browser", false, "print the address only, open no browser")
	flags.Usage = func() {
		fmt.Fprint(flags.Output(), usage)
		flags.PrintDefaults()
	}
	_ = flags.Parse(os.Args[1:])
	var err error
	switch args := flags.Args(); {
	case len(args) == 1 && args[0] == "serve":
		err = serve()
	case len(args) > 1:
		flags.Usage()
		os.Exit(2)
	default:
		target := "."
		if len(args) == 1 {
			target = args[0]
		}
		err = edit(target, !*noBrowser)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "zwiebelfisch:", err)
		os.Exit(1)
	}
}

const usage = `Usage:
  zwiebelfisch [file or folder]   edit a folder's Typst project in the browser ("." without one)
  zwiebelfisch serve              run the collaboration server (configured by ZWF_* variables)

`
