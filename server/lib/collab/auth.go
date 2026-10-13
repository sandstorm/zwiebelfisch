package collab

import (
	"crypto/subtle"
	"errors"
)

// Authenticate decides whether a client may open a room: it returns who the token belongs to, or an error
// to refuse (the client gets PermissionDenied; a Refusal's reason is what it is told).
type Authenticate func(token, room string) (User, error)

// User is what the server knows about a client (for logs, and later the author of GitLab commits).
type User struct {
	Name, Email string
}

// ErrInvalidToken refuses a client.
var ErrInvalidToken = errors.New("collab: invalid token")

// Refusal refuses a client with a reason meant for its user (the PermissionDenied reason, which the widget
// shows). Other errors are reported as Hocuspocus' "permission-denied".
type Refusal struct{ Reason string }

func (r Refusal) Error() string { return r.Reason }

// SharedToken is the check until there is a real one (GitLab sign-in, see docs/40_architecture/11_development.typ,
// "Open work"): with expected nil every client may open every room; otherwise the client's token must
// equal it (also when it is empty).
func SharedToken(expected *string) Authenticate {
	return func(token, _ string) (User, error) {
		if expected != nil && subtle.ConstantTimeCompare([]byte(token), []byte(*expected)) != 1 {
			return User{}, ErrInvalidToken
		}
		return User{}, nil
	}
}
