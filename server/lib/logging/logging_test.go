package logging_test

import (
	"bytes"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/sandstorm/zwiebelfisch/server/lib/logging"
)

func TestJSONAtLevel(t *testing.T) {
	var out bytes.Buffer
	log, err := logging.New(&out, "json", "info")
	require.NoError(t, err)
	log.Debug().Msg("hidden")
	log.Info().Str("room", "r").Msg("shown")
	var line map[string]any
	require.NoError(t, json.Unmarshal(out.Bytes(), &line))
	require.Equal(t, "shown", line["message"])
	require.Equal(t, "r", line["room"])
}

func TestConsoleAndBadLevel(t *testing.T) {
	var out bytes.Buffer
	log, err := logging.New(&out, "console", "debug")
	require.NoError(t, err)
	log.Debug().Msg("hello")
	require.Contains(t, out.String(), "hello")
	_, err = logging.New(&out, "json", "loud")
	require.Error(t, err)
}
