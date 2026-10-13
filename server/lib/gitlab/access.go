package gitlab

// Who may edit and save a GitLab room. The bot commits for everyone, so its rights must not become
// everyone's: a user joins (and edits) with the Developer role or more on the project, and a save also needs
// the right to push to the branch (protected branches). The repository is asked with the bot's credentials
// (Repository.Access); no user token is used. Answers are kept a minute for joins and file requests (a
// project's images are many requests); a save asks again.

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/sandstorm/zwiebelfisch/server/lib/collab"
)

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
// saying why not.
func (x *Rooms) Authorize(ctx context.Context, user collab.User, name string) error {
	project, branch, ok := x.parseRoomName(name)
	if !ok {
		return collab.Refusal{Reason: fmt.Sprintf("%q is not a GitLab room.", name)}
	}
	a, err := x.access(ctx, user, project, branch, true)
	if err != nil {
		return err
	}
	if !a.Edit {
		return x.notEditor(project, a)
	}
	return nil
}

// mayPush is why user may not save the room's branch now (nil: they may), asking afresh.
func (x *Rooms) mayPush(ctx context.Context, user collab.User, project, branch string) error {
	a, err := x.access(ctx, user, project, branch, false)
	switch {
	case err != nil:
		return err
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

// access is what user may do with project's branch; cached: an answer younger than accessTTL will do.
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
	a, err := x.opts.repository(project).Access(ctx, user.ID, branch)
	if err != nil {
		x.log.Warn().Err(err).Str("project", project).Str("user", user.ID).Msg("cannot check access")
		return Access{}, collab.Refusal{Reason: "Cannot check your access on GitLab: " + failureMessage(err)}
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
