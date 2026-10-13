package collab

import (
	"net/http"
)

// Authenticate decides whether the client that sent r may open room: it returns who the client is, or an
// error to refuse (the client gets PermissionDenied; a Refusal's reason is what it is told). For a WebSocket,
// r is the upgrade request: the session cookie it carries says who the connection is (package auth). The
// token of Hocuspocus' Auth message is not used.
type Authenticate func(r *http.Request, room string) (User, error)

// User is who a client signed in as: (Provider, ID) identifies them, ID being the provider's user id (for
// GitLab rooms, the GitLab user whose access is checked). The zero User is a client of unknown identity.
type User struct {
	Provider, ID string
	Name, Email  string
}

// Refusal refuses a client with a reason meant for its user (the PermissionDenied reason, which the widget
// shows). Other errors are reported as Hocuspocus' "permission-denied".
type Refusal struct{ Reason string }

func (r Refusal) Error() string { return r.Reason }
