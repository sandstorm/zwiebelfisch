// Package config reads the server's settings: defaults, then environment variables.
//
//	ZWF_ALLOWED_ORIGINS (required) the pages that may use a session, comma-separated exact origins
//	                    (scheme://host[:port]), e.g. https://editor.example.org; Load fails without one or
//	                    on an invalid one (auth.ParseOrigin)
//	PORT                (default 1234)
//	ZWF_ADDRESS       (default 127.0.0.1) the interface to listen on; 0.0.0.0 in a container
//	ZWF_COLLAB_DB     (default server/.data/collab.sqlite; ":memory:" keeps nothing) the rooms; the GitLab
//	                    projects' git clones go in the folder repositories/ next to it
//	ZWF_PLAIN_ROOMS   (default off) 1/true: also serve plain rooms (any other name), backed by nothing but the DB
//	ZWF_GUESTS        (default off) 1/true: members may share a room with guests by a link (package guest)
//	ZWF_LOG_LEVEL     (default info) debug, info, warn, error
//	ZWF_LOG_FORMAT    (default console) console (for people) or json (for log collectors)
//	ZWF_WEB_DIST      (default unset) a built app (dist/app) to serve next to /api/, on the same port
//
// GitLab rooms (`gitlab:<project id or path>@<branch>`), enabled when the URL is set. Everything is done
// with the signed-in user's own OAuth token (the sign-in's scopes include read_api and write_repository):
//
//	ZWF_GITLAB_URL             e.g. https://gitlab.com
//	ZWF_GITLAB_WEBHOOK_SECRET  (optional) enables POST /api/public/gitlab/webhook for push events
//	ZWF_GITLAB_AUTHOR_EMAIL    (optional) an editor's email in commits when theirs is unknown, and the committer's
//	ZWF_GITLAB_AUTO_COMMIT     (default 10) minutes without edits before a room commits by itself; off: never
//
// Sign-in (OpenID Connect, required; package auth). The default provider is the GitLab instance:
//
//	ZWF_AUTH_ISSUER         (default ZWF_GITLAB_URL) the issuer; another one signs people in, but GitLab
//	                          rooms refuse them (their GitLab user is unknown)
//	ZWF_AUTH_CLIENT_ID      the application registered at the provider
//	ZWF_AUTH_CLIENT_SECRET  its secret
//	ZWF_AUTH_REDIRECT_URL   (default: /api/public/auth/callback on the host the browser names) the callback registered
//	                          with the application, e.g. https://editor.example.org/api/public/auth/callback
//
// Only these names are read.
package config

import (
	"fmt"
	"strings"

	"github.com/knadh/koanf/providers/confmap"
	"github.com/knadh/koanf/providers/env/v2"
	"github.com/knadh/koanf/v2"

	"github.com/sandstorm/zwiebelfisch/server/lib/auth"
)

// Config is the server's configuration.
type Config struct {
	// AllowedOrigins are ZWF_ALLOWED_ORIGINS's origins, as auth.ParseOrigin returns them: at least one.
	AllowedOrigins []string `koanf:"-"`
	Address        string   `koanf:"address"`
	Port           int      `koanf:"port"`
	Collab         struct {
		DB string `koanf:"db"`
	} `koanf:"collab"`
	Auth struct {
		Issuer       string `koanf:"issuer"`
		ClientID     string `koanf:"client_id"`
		ClientSecret string `koanf:"client_secret"`
		RedirectURL  string `koanf:"redirect_url"`
	} `koanf:"auth"`
	Rooms struct {
		Plain  bool `koanf:"plain"`
		Guests bool `koanf:"guests"`
	} `koanf:"rooms"`
	GitLab struct {
		URL           string `koanf:"url"`
		WebhookSecret string `koanf:"webhook_secret"`
		AuthorEmail   string `koanf:"author_email"`
		// AutoCommit as written (gitlab.ParseAutoCommit reads it).
		AutoCommit string `koanf:"auto_commit"`
	} `koanf:"gitlab"`
	Log struct {
		Level  string `koanf:"level"`
		Format string `koanf:"format"`
	} `koanf:"log"`
	Web struct {
		Dist string `koanf:"dist"`
	} `koanf:"web"`
}

var defaults = map[string]any{
	"address":    "127.0.0.1",
	"port":       1234,
	"collab.db":  "server/.data/collab.sqlite",
	"log.level":  "info",
	"log.format": "console",
}

// allowedOriginsExample is how ZWF_ALLOWED_ORIGINS looks, for the errors.
const allowedOriginsExample = "e.g. ZWF_ALLOWED_ORIGINS=https://editor.example.org,http://localhost:5199"

var envKeys = map[string]string{
	"ZWF_ALLOWED_ORIGINS": "allowed_origins",

	"PORT":            "port",
	"ZWF_ADDRESS":     "address",
	"ZWF_COLLAB_DB":   "collab.db",
	"ZWF_PLAIN_ROOMS": "rooms.plain",
	"ZWF_GUESTS":      "rooms.guests",
	"ZWF_LOG_LEVEL":   "log.level",
	"ZWF_LOG_FORMAT":  "log.format",
	"ZWF_WEB_DIST":    "web.dist",

	"ZWF_AUTH_ISSUER":        "auth.issuer",
	"ZWF_AUTH_CLIENT_ID":     "auth.client_id",
	"ZWF_AUTH_CLIENT_SECRET": "auth.client_secret",
	"ZWF_AUTH_REDIRECT_URL":  "auth.redirect_url",

	"ZWF_GITLAB_URL":            "gitlab.url",
	"ZWF_GITLAB_WEBHOOK_SECRET": "gitlab.webhook_secret",
	"ZWF_GITLAB_AUTHOR_EMAIL":   "gitlab.author_email",
	"ZWF_GITLAB_AUTO_COMMIT":    "gitlab.auto_commit",
}

// Load reads the configuration from environ (os.Environ()'s format: "NAME=value").
func Load(environ []string) (Config, error) {
	k := koanf.New(".")
	if err := k.Load(confmap.Provider(defaults, "."), nil); err != nil {
		return Config{}, fmt.Errorf("config: %w", err)
	}
	vars := env.Provider(".", env.Opt{
		TransformFunc: func(name, value string) (string, any) { return envKeys[name], value },
		EnvironFunc:   func() []string { return environ },
	})
	if err := k.Load(vars, nil); err != nil {
		return Config{}, fmt.Errorf("config: %w", err)
	}
	var c Config
	if err := k.Unmarshal("", &c); err != nil {
		return Config{}, fmt.Errorf("config: %w", err)
	}
	if c.Port <= 0 || c.Port > 65535 {
		return Config{}, fmt.Errorf("config: PORT %d is not a port", c.Port)
	}
	if c.Auth.Issuer == "" {
		c.Auth.Issuer = c.GitLab.URL
	}
	if c.Log.Format != "console" && c.Log.Format != "json" {
		return Config{}, fmt.Errorf("config: ZWF_LOG_FORMAT %q is neither console nor json", c.Log.Format)
	}
	origins, err := allowedOrigins(k.String("allowed_origins"))
	if err != nil {
		return Config{}, err
	}
	c.AllowedOrigins = origins
	return c, nil
}

// allowedOrigins is the comma-separated list as auth.ParseOrigin returns each entry; an error for an empty
// list or entry, or an entry ParseOrigin refuses.
func allowedOrigins(list string) ([]string, error) {
	if strings.TrimSpace(list) == "" {
		return nil, fmt.Errorf("config: ZWF_ALLOWED_ORIGINS is required: the origins of the pages that embed the editor, comma-separated (%s)", allowedOriginsExample)
	}
	var origins []string
	for _, raw := range strings.Split(list, ",") {
		origin, err := auth.ParseOrigin(strings.TrimSpace(raw))
		if err != nil {
			return nil, fmt.Errorf("config: ZWF_ALLOWED_ORIGINS: %w; each entry is scheme://host[:port] (%s)", err, allowedOriginsExample)
		}
		origins = append(origins, origin)
	}
	return origins, nil
}
