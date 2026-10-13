package gitlab

import (
	"context"
	"errors"
)

// Repository is a branch-holding repository as a room needs it: read a commit's files, commit the room's
// changes, tell who may do so. It is the seam for other providers (GitHub, Gitea): the room logic knows nothing of GitLab's
// REST API (api.go implements Repository for GitLab).
type Repository interface {
	// Head is the commit branch points at.
	Head(ctx context.Context, branch string) (string, error)
	// Tree lists every file (blob) of the commit sha.
	Tree(ctx context.Context, sha string) ([]TreeEntry, error)
	// Blob returns the bytes of a blob.
	Blob(ctx context.Context, sha string) ([]byte, error)
	// Commit makes one commit of actions on top of ExpectedHead, which must still be the branch's head (else
	// ErrConflict: upstream moved, nothing was committed).
	Commit(ctx context.Context, c CommitRequest) (Commit, error)
	// Access is what user (the provider's user id) may do with branch, as the repository's credentials (the
	// bot's) can tell.
	Access(ctx context.Context, user, branch string) (Access, error)
}

// Access is what a user may do with a branch.
type Access struct {
	// Role is the user's role on the project in the provider's words ("Reporter"); "": not a member.
	Role string
	// Edit: the role may change the branch (GitLab: Developer or more): join the room.
	Edit bool
	// Push: no protection of the branch keeps the user from pushing to it: save.
	Push bool
}

// TreeEntry is a file of a commit: its path in the repository ("/chapter.typ") and blob sha.
type TreeEntry struct{ Path, Sha string }

// CommitRequest is one commit. Its author is whoever the repository's credentials belong to (the bot);
// the editors are named in Message.
type CommitRequest struct {
	Branch, ExpectedHead, Message string
	Actions                       []Action
}

// Commit is a commit made: its sha and its parent's.
type Commit struct{ Sha, Parent string }

// Action is one change of a commit.
type Action struct {
	Kind         ActionKind
	Path         string // "/chapter.typ"
	PreviousPath string // ActionMove: where the file was
	Content      []byte // ActionCreate, ActionUpdate; ActionMove with new content (nil: the content stays)
	Text         bool   // Content is text (else binary)
}

type ActionKind string

const (
	ActionCreate ActionKind = "create"
	ActionUpdate ActionKind = "update"
	ActionDelete ActionKind = "delete"
	ActionMove   ActionKind = "move"
)

// ErrConflict: the branch is not at the commit expected; nothing was committed.
var ErrConflict = errors.New("gitlab: the branch moved")
