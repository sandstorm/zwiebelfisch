// Package logging creates the server's zerolog logger (as sandstorm/dashica): readable lines on a
// terminal in development, JSON for log collectors in production.
package logging

import (
	"fmt"
	"io"
	"time"

	"github.com/rs/zerolog"
)

// New returns a logger writing to w in format "console" or "json", at level (debug, info, warn, error).
func New(w io.Writer, format, level string) (zerolog.Logger, error) {
	lvl, err := zerolog.ParseLevel(level)
	if err != nil || level == "" {
		return zerolog.Nop(), fmt.Errorf("logging: unknown level %q", level)
	}
	if format == "console" {
		w = zerolog.ConsoleWriter{Out: w, TimeFormat: time.TimeOnly}
	}
	return zerolog.New(w).Level(lvl).With().Timestamp().Logger(), nil
}
