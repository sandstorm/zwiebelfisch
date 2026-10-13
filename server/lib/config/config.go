// Package config reads the server's settings: defaults, then environment variables (koanf, as in
// sandstorm/dashica).
//
// The variables are the ones the TypeScript server reads (server/src/main.ts), so both run the same way:
//
//	PORT                (default 1234)
//	TYPST_ADDRESS       (default 127.0.0.1) the interface to listen on; 0.0.0.0 in a container
//	TYPST_COLLAB_DB     (default server/.data/collab.sqlite; ":memory:" keeps nothing)
//	TYPST_COLLAB_TOKEN  (default empty: no check) the token clients must send
//	TYPST_LOG_LEVEL     (default info) debug, info, warn, error
//	TYPST_LOG_FORMAT    (default console) console (for people) or json (for log collectors)
//
// Only these names are read, each mapped to a key explicitly: secrets come from the environment
// (mise.local.toml or .env, never committed), and a typo in a name should not be silently half-parsed.
package config

import (
	"fmt"

	"github.com/knadh/koanf/providers/confmap"
	"github.com/knadh/koanf/providers/env/v2"
	"github.com/knadh/koanf/v2"
)

// Config is the server's configuration.
type Config struct {
	Address string `koanf:"address"`
	Port    int    `koanf:"port"`
	Collab  struct {
		DB    string `koanf:"db"`
		Token string `koanf:"token"`
	} `koanf:"collab"`
	Log struct {
		Level  string `koanf:"level"`
		Format string `koanf:"format"`
	} `koanf:"log"`
}

var defaults = map[string]any{
	"address":    "127.0.0.1",
	"port":       1234,
	"collab.db":  "server/.data/collab.sqlite",
	"log.level":  "info",
	"log.format": "console",
}

var envKeys = map[string]string{
	"PORT":               "port",
	"TYPST_ADDRESS":      "address",
	"TYPST_COLLAB_DB":    "collab.db",
	"TYPST_COLLAB_TOKEN": "collab.token",
	"TYPST_LOG_LEVEL":    "log.level",
	"TYPST_LOG_FORMAT":   "log.format",
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
	if c.Log.Format != "console" && c.Log.Format != "json" {
		return Config{}, fmt.Errorf("config: TYPST_LOG_FORMAT %q is neither console nor json", c.Log.Format)
	}
	return c, nil
}
