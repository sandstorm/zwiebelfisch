package gitlab

// Who may edit and save a GitLab room, as GitLab tells the user (asked with their own token):
//   - join (and edit), and share it with guests: the Developer role or more on the project (members/all/<user>)
//   - save: also the right to push to the branch (branches/<branch>: can_push); a guest never saves
//
// A join or a file request may rely on an answer up to a minute old; a save and an auto-save always ask
// again.

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/sandstorm/zwiebelfisch/server/lib/collab"
)

// Access is what a user may do with a branch.
type Access struct {
	// Role is the user's role on the project in GitLab's words ("Reporter"); "": not a member.
	Role string
	// Edit: the role may change the branch (Developer or more): join the room.
	Edit bool
	// Push: GitLab lets the user push to the branch (protected branches included): save.
	Push bool
}

// accessTTL is how long a join or a file request may rely on an earlier answer.
const accessTTL = time.Minute

type accessCache struct {
	mu      sync.Mutex
	entries map[accessKey]cachedAccess
}

type accessKey struct{ project, branch, user string }

type cachedAccess struct {
	access Access
	at     time.Time
}

// Authorize decides whether user may open the room name (one of these rooms): nil, or a collab.Refusal
// saying why not. An open room that missed a push (pushed found nobody to fetch it for) fetches it now, as
// user.
func (x *Rooms) Authorize(ctx context.Context, user collab.User, name string) error {
	project, branch, _, ok := x.parseRoomName(name)
	if !ok {
		return collab.Refusal{Reason: fmt.Sprintf("%q is not a GitLab room.", name)}
	}
	a, err := x.access(ctx, user, project, branch, true)
	if err != nil {
		return refusalOf(err)
	}
	if !a.Edit {
		return x.notEditor(project, a)
	}
	x.mu.Lock()
	open := x.open[name]
	x.mu.Unlock()
	if open != nil && open.stale.CompareAndSwap(true, false) {
		x.goTask(func() { open.pullAs(x.ctx, user) })
	}
	return nil
}

// MayEdit is whether user may edit the room name (one of these rooms): true or false as GitLab says (an
// answer up to a minute old will do), an error when that cannot be told now (they are signed out, GitLab
// cannot be reached).
func (x *Rooms) MayEdit(ctx context.Context, user collab.User, name string) (bool, error) {
	project, branch, _, ok := x.parseRoomName(name)
	if !ok || user.Provider != x.opts.ID {
		return false, nil
	}
	a, err := x.access(ctx, user, project, branch, true)
	if err != nil {
		return false, err
	}
	return a.Edit, nil
}

// errGuestSaves refuses a guest's save.
var errGuestSaves = collab.Refusal{Reason: "Guests cannot save; a member saves your edits."}

// mayPush is why user may not save the room's branch now (nil: they may), asking afresh.
func (x *Rooms) mayPush(ctx context.Context, user collab.User, project, branch string) error {
	if user.IsGuest() {
		return errGuestSaves
	}
	a, err := x.access(ctx, user, project, branch, false)
	switch {
	case err != nil:
		return refusalOf(err)
	case !a.Edit:
		return x.notEditor(project, a)
	case !a.Push:
		return collab.Refusal{Reason: fmt.Sprintf("%s is protected and you may not push to it.", branch)}
	}
	return nil
}

func (x *Rooms) notEditor(project string, a Access) error {
	if a.Role == "" {
		return collab.Refusal{Reason: fmt.Sprintf("You are not a member of %s on GitLab.", project)}
	}
	return collab.Refusal{Reason: fmt.Sprintf("Editing %s needs the Developer role on GitLab; you are %s.", project, a.Role)}
}

// errSignedOut: the user has no live sign-in, so nothing can be asked or done in their name.
var errSignedOut = collab.Refusal{Reason: "Sign in with GitLab again."}

// refusalOf is err of access as the user is told it: a collab.Refusal.
func refusalOf(err error) error {
	if _, ok := err.(collab.Refusal); ok {
		return err
	}
	return collab.Refusal{Reason: "Cannot check your access on GitLab: " + failureMessage(err)}
}

// access is what user may do with project's branch; cached: an answer younger than accessTTL will do. Its
// error is a collab.Refusal when the user cannot be asked for (errSignedOut included), else GitLab's.
func (x *Rooms) access(ctx context.Context, user collab.User, project, branch string, cached bool) (Access, error) {
	if user.Provider != x.opts.ID || user.ID == "" {
		return Access{}, collab.Refusal{Reason: "Sign in with GitLab to open GitLab projects."}
	}
	key := accessKey{project, branch, user.ID}
	now := x.clock.Now()
	if cached {
		x.accessCache.mu.Lock()
		hit, ok := x.accessCache.entries[key]
		x.accessCache.mu.Unlock()
		if ok && now.Sub(hit.at) < accessTTL {
			return hit.access, nil
		}
	}
	token, err := x.token(ctx, user)
	if err != nil {
		return Access{}, err
	}
	a, err := x.opts.access(ctx, token, project, branch, user.ID)
	if err != nil {
		x.log.Warn().Err(err).Str("project", project).Str("user", user.ID).Msg("cannot check access")
		return Access{}, err
	}
	x.accessCache.mu.Lock()
	defer x.accessCache.mu.Unlock()
	for k, e := range x.accessCache.entries { // stays small: only recent answers
		if now.Sub(e.at) >= accessTTL {
			delete(x.accessCache.entries, k)
		}
	}
	x.accessCache.entries[key] = cachedAccess{a, now}
	return a, nil
}

// token is user's OAuth token (Options.Token), errSignedOut without a live sign-in.
func (x *Rooms) token(ctx context.Context, user collab.User) (string, error) {
	if user.Provider != x.opts.ID || user.ID == "" || x.opts.Token == nil {
		return "", errSignedOut
	}
	token, err := x.opts.Token(ctx, user.ID)
	if err != nil || token == "" {
		return "", errSignedOut
	}
	return token, nil
}

// userAccess asks GitLab, with the user's own token, for their role on project and whether they may push
// to branch.
func (a api) userAccess(ctx context.Context, token, project, branch, user string) (Access, error) {
	base := "/projects/" + url.PathEscape(project)
	var member struct {
		Level int `json:"access_level"`
	}
	if err := a.get(ctx, token, base+"/members/all/"+url.PathEscape(user), &member); err != nil {
		var refused *APIError
		if errors.As(err, &refused) && refused.Status == http.StatusNotFound {
			return Access{}, nil
		}
		return Access{}, err
	}
	access := Access{Role: roleName(member.Level), Edit: member.Level >= developer}
	if !access.Edit {
		return access, nil
	}
	var b struct {
		CanPush bool `json:"can_push"`
	}
	if err := a.get(ctx, token, base+"/repository/branches/"+url.PathEscape(branch), &b); err != nil {
		return Access{}, err
	}
	access.Push = b.CanPush
	return access, nil
}

const developer = 30

func roleName(level int) string {
	switch {
	case level >= 50:
		return "Owner"
	case level >= 40:
		return "Maintainer"
	case level >= 30:
		return "Developer"
	case level >= 20:
		return "Reporter"
	case level >= 15:
		return "Planner"
	case level >= 10:
		return "Guest"
	case level > 0:
		return "Minimal Access"
	}
	return ""
}
