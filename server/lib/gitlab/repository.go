package gitlab

import (
	"context"
	"errors"
	"time"
)

// Repository is a project's repository as a room needs it: fetch a branch, read a commit's files, commit
// the room's changes, read the history. Every call that talks to GitLab takes the OAuth token of the user it acts for; reads
// of what was fetched talk to nobody. GitLab's is the git clone of git.go.
type Repository interface {
	// Head fetches branch (its commits, trees and files) and returns the commit it points at; Tree and Blobs
	// then know it.
	Head(ctx context.Context, token, branch string) (string, error)
	// Tree lists every file (blob) of the commit sha, fetched before.
	Tree(sha string) ([]TreeEntry, error)
	// Blobs returns the bytes of the blobs shas (of commits fetched before), in their order. A blob larger
	// than maxBlobSize is not read: errTooLarge.
	Blobs(shas []string) ([][]byte, error)
	// Commit makes one commit of actions on top of ExpectedHead and pushes it, unless the branch is no longer
	// at ExpectedHead (ErrConflict: nothing was committed) or an action's path is not one git takes
	// (errBadPath). It returns the commit's sha.
	Commit(ctx context.Context, token string, c CommitRequest) (string, error)
	// Log lists the commits reachable from q.Sha (fetched before) that change q.Path against their first
	// parent, newest first (by commit time), at most q.Limit (fewer, even none, once it checked logWork
	// commits); next continues the list as q.Cursor ("": no more). An unknown cursor: errBadCursor.
	Log(q LogQuery) (commits []CommitInfo, next string, err error)
	// Compare lists the files that differ from commit from to commit sha; from "": sha's first parent (a
	// commit without one: every file added). A file moved unchanged is renamed.
	Compare(from, sha string) ([]FileChange, error)
	// File is path's content at commit sha; false: no such file there. Larger than maxBlobSize: errTooLarge.
	File(sha, path string) ([]byte, bool, error)
}

// LogQuery is what Log lists. Path: "" every commit, "/chapters/" a folder's, "/a.typ" a file's. Cursor
// (from an earlier Log, "": from Sha on) takes the place of Sha.
type LogQuery struct {
	Sha, Path, Cursor string
	Limit             int
}

// CommitInfo is a commit as history shows it.
type CommitInfo struct {
	Sha     string
	Parents []string
	Message string // trailers included
	Author  Signature
	At      time.Time // when it was committed
}

// FileChange is a file a commit changed: Kind added, modified, deleted or renamed (from PreviousPath).
type FileChange struct{ Path, PreviousPath, Kind string }

// TreeEntry is a file of a commit: its path in the repository ("/chapter.typ") and blob sha.
type TreeEntry struct{ Path, Sha string }

// CommitRequest is one commit: by Author (the user whose token pushes it), the other editors named in
// Message.
type CommitRequest struct {
	Branch, ExpectedHead, Message string
	Author                        Signature
	Actions                       []Action
}

// Signature is who made a commit.
type Signature struct{ Name, Email string }

// Action is one change of a commit.
type Action struct {
	Kind         ActionKind
	Path         string // "/chapter.typ"
	PreviousPath string // ActionMove: where the file was
	Content      []byte // ActionCreate, ActionUpdate; ActionMove with new content (nil: the content stays)
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

// maxBlobSize is the largest file a room reads from the repository.
const maxBlobSize = 32 << 20

// errBadPath: a commit names a file git does not take (an empty, ".", ".." or ".git" part, or a file where
// a folder is); nothing was committed.
var errBadPath = errors.New("is not a file name git takes")

// errBadCursor: a Log cursor that no Log made.
var errBadCursor = errors.New("not a cursor of this history")

// errTooLarge: a file is larger than maxBlobSize.
var errTooLarge = errors.New("a file is larger than 32 MiB, more than Zwiebelfisch reads")
