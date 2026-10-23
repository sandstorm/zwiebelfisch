package gitlab

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode/utf8"

	"github.com/sandstorm/zwiebelfisch/server/lib/collab"
	"github.com/sandstorm/zwiebelfisch/server/lib/ydoc"
)

// room is one room backed by a branch: it loads the branch into the room's document, commits the room's
// changes (on a save, or by itself when nobody edited for a while or the last user left) and merges
// upstream pushes into it.
//
// The room holds the files of its folder (dir; the whole repository without one) and the files from outside
// it that a client asked for (pullIn, kept in meta.pulledIn): nothing else of the repository reaches the
// document, and upstream changes to other files leave it alone. A commit never creates, renames or deletes
// a file outside the folder.
//
// Everyone in the room sees in the document:
//   - what is not committed yet and by whom (changes)
//   - a conflict with upstream (conflict, until a merge succeeds)
//   - a failed commit (commitFailure, until the next commit or merge)
//
// A room stored and loaded again continues where it was; only the count of edits per editor starts over.
// Save, pull and commit run one at a time, and clients keep editing while they talk to the repository.
// Each talks to it with the token of the user it acts for: who opens, who is in the room, who saves.
type room struct {
	x       *Rooms
	host    host
	repo    Repository
	name    string
	project string
	branch  string
	dir     string // the room's folder ("/report/2026"); "": the whole repository

	ops      sync.Mutex // one operation at a time
	disposed atomic.Bool
	stale    atomic.Bool // a push came while nobody signed in was here to fetch it

	// on the host's goroutine (Open, Handler methods, update listeners, Do)
	editors      editors
	changesTimer func() bool // pending tellChanges; nil: none
	idleTimer    func() bool
	stopUpdates  func()
}

// host is the collaboration room a room lives in: collab.Room.
type host interface {
	Do(fn func(doc *ydoc.Doc)) bool
	BroadcastStateless(payload string)
	Empty() bool
	Users() []collab.User
}

// errGone: the room unloaded while an operation ran.
var errGone = errors.New("gitlab: the room was unloaded")

// open loads the branch into a room that has no base yet, with by's token; brings a stored room up to date
// with upstream instead (or opens it as it is when the repository cannot be reached; the next pull or save
// catches up). Called on the host's goroutine, before anyone joins.
func (r *room) open(ctx context.Context, doc *ydoc.Doc, by collab.User) error {
	var stored roomChanges
	if readValue(doc, metaChanges, &stored) {
		r.editors.since = stored.Since
		for i, name := range stored.Editors {
			var user collab.User
			if i < len(stored.EditorIDs) && stored.EditorIDs[i] != "" {
				user = collab.User{Provider: r.x.opts.ID, ID: stored.EditorIDs[i]}
			}
			p := r.x.person(user, name, "")
			r.editors.edited(p, stored.Since)
			r.editors.by[p.key()].edits = 0
		}
	}
	if err := r.writeAutoCommit(doc); err != nil {
		return err
	}
	token, tokenErr := r.x.token(ctx, by)
	if b := readMeta(doc); b != nil {
		if tokenErr != nil {
			r.stale.Store(true)
		} else if head, err := r.repo.Head(ctx, token, r.branch); err != nil {
			r.stale.Store(true)
		} else if head != b.Sha {
			if upstream, err := r.snapshot(head, readPulledIn(doc)); err == nil {
				r.applyMerge(doc, upstream)
			}
		}
	} else {
		if tokenErr != nil {
			return tokenErr
		}
		head, err := r.repo.Head(ctx, token, r.branch)
		if err != nil {
			return err
		}
		snapshot, err := r.snapshot(head, nil)
		if err != nil {
			return err
		}
		err = r.write(doc, func(w *ydoc.Writer) {
			for path, text := range snapshot.Texts {
				w.SetText(filesMap, path, text)
			}
			for path, sha := range snapshot.Assets {
				w.Set(assetsMap, path, sha)
			}
			writeBase(w, doc, snapshot)
		})
		if err != nil {
			return err
		}
	}
	r.tellChanges(doc)
	r.stopUpdates = doc.OnUpdate(r.updated)
	return nil
}

// Stateless handles a client's message:
//   - a save (gitlab:save), if the client's user may push to the branch: the outcome goes to everyone, or
//     (nothing to commit, an error, a refusal) to the saving client only
//   - a request for a file from outside the room's folder (gitlab:pull): pullIn; a refusal goes to the client
func (r *room) Stateless(p *collab.Peer, payload string) {
	if path, ok := parsePull(payload); ok {
		r.x.goTask(func() {
			if refused := r.pullIn(path); refused != nil {
				p.SendStateless(refused.json())
			}
		})
		return
	}
	text, ok := parseSave(payload)
	if !ok {
		return
	}
	saver := r.x.editorOf(p)
	r.x.goTask(func() {
		if saver == nil {
			p.SendStateless(message{Type: msgError, Message: errSignedOut.Error()}.json())
			return
		}
		if err := r.x.mayPush(r.x.ctx, saver.User, r.project, r.branch); err != nil {
			p.SendStateless(message{Type: msgError, Message: err.Error()}.json())
			return
		}
		result := r.save(r.x.ctx, *saver, text)
		if result.Type == msgUnchanged || result.Type == msgError {
			p.SendStateless(result.json())
		} else {
			r.host.BroadcastStateless(result.json())
		}
	})
}

// parseSave reads a save (gitlab:save): the commit message (default "Edit via Zwiebelfisch").
func parseSave(payload string) (text string, ok bool) {
	var m clientMessage
	if json.Unmarshal([]byte(payload), &m) != nil || m.Type != "gitlab:save" {
		return "", false
	}
	if text = strings.TrimSpace(m.Message); text == "" {
		text = defaultCommitMessage
	}
	return text, true
}

// parsePull reads a request for a file (gitlab:pull): its path.
func parsePull(payload string) (path string, ok bool) {
	var m clientMessage
	if json.Unmarshal([]byte(payload), &m) != nil || m.Type != "gitlab:pull" {
		return "", false
	}
	return m.Path, true
}

// pullIn adds the file path from outside the room's folder to the room as it is at the room's base (a .typ
// file as text, any other by blob sha) and to meta.pulledIn; merges and commits then treat it as any file of
// the room. A file the room holds stays as it is (nil). The refusal (msgMissing) says why not: no file of the
// base, a path in the folder, more than maxPulledIn files, larger than maxBlobSize.
func (r *room) pullIn(path string) *message {
	var refused *message
	r.run(func() message {
		var b *base
		var pulled []string
		if !r.host.Do(func(doc *ydoc.Doc) {
			if b = readMeta(doc); b != nil {
				pulled = readPulledIn(doc)
			}
		}) || b == nil || slices.Contains(pulled, path) {
			return message{}
		}
		missing := func(why string) message {
			refused = &message{Type: msgMissing, Path: path, Message: why}
			return message{}
		}
		switch {
		case !strings.HasPrefix(path, "/") || !gitPath(path[1:]):
			return missing(fmt.Sprintf("%q is not a file name git takes.", path))
		case r.inFolder(path):
			return missing(fmt.Sprintf("%s is in the project folder %s, not outside it.", path, r.dir))
		case len(pulled) >= maxPulledIn:
			return missing(fmt.Sprintf("%s is not loaded: a room holds at most %d files from outside its folder %s.", path, maxPulledIn, r.dir))
		}
		entries, err := r.repo.Tree(b.Sha)
		if err != nil {
			return missing(failureMessage(err))
		}
		i := slices.IndexFunc(entries, func(e TreeEntry) bool { return e.Path == path })
		if i < 0 {
			return missing(fmt.Sprintf("%s is not a file in the repository.", path))
		}
		sha := entries[i].Sha
		var text *string
		if strings.HasSuffix(path, ".typ") {
			contents, err := r.repo.Blobs([]string{sha})
			if err != nil {
				return missing(failureMessage(err))
			}
			t := decodeText(contents[0])
			text = &t
		}
		r.host.Do(func(doc *ydoc.Doc) {
			r.logErr(r.write(doc, func(w *ydoc.Writer) {
				if text != nil {
					b.Texts[path] = *text
					w.SetText(filesMap, path, *text)
					w.Set(metaMap, "base", plain(b.Texts))
				} else {
					b.Assets[path] = sha
					w.Set(assetsMap, path, sha)
					w.Set(metaMap, "baseAssets", plain(b.Assets))
				}
				w.Set(metaMap, metaPulledIn, plain(slices.Sorted(slices.Values(append(pulled, path)))))
			}), "cannot pull in a file")
		})
		return message{}
	})
	return refused
}

// inFolder is whether path ("/report/2026/main.typ") is in the room's folder.
func (r *room) inFolder(path string) bool {
	return r.dir == "" || strings.HasPrefix(path, r.dir+"/")
}

// outsideFolder is why actions may not be committed ("": they may): one creates, renames or deletes a file
// outside the room's folder.
func (r *room) outsideFolder(actions []Action) string {
	for _, a := range actions {
		if a.Kind == ActionUpdate {
			continue
		}
		for _, p := range []string{a.Path, a.PreviousPath} {
			if p != "" && !r.inFolder(p) {
				return fmt.Sprintf("Not saved: %s is outside the project folder %s, where files are only edited, never created, renamed or deleted.", p, r.dir)
			}
		}
	}
	return ""
}

// Left: the last user (last) left. meta.changes is told now (the room is stored as it is when Left
// returns). With auto-commit, the room commits its changes after leaveDelay (in last's name, if the rules
// let it), unless someone is back by then (a reload).
func (r *room) Left(ctx context.Context, last collab.User) {
	r.x.task(func() {
		r.host.Do(r.tellChanges)
		if r.autoCommit() == 0 || !r.hasChanges() {
			return
		}
		if !r.x.sleep(ctx, r.x.leaveDelay) || !r.host.Empty() {
			return
		}
		r.autoCommitNow(last)
	})
}

// Close: the room unloads; it stops following edits.
func (r *room) Close() {
	r.disposed.Store(true)
	for _, stop := range []func() bool{r.changesTimer, r.idleTimer} {
		if stop != nil {
			stop()
		}
	}
	if r.stopUpdates != nil {
		r.stopUpdates()
	}
	r.x.forget(r)
}

// save commits the room's changes since its base as one commit by saver (with their token), the other
// editors as co-authors. When upstream moved meanwhile, it merges upstream first and tries again; a
// conflict ends the save.
func (r *room) save(ctx context.Context, saver person, text string) message {
	return r.run(func() message {
		return r.commitNow(ctx, func(e editors, _ []string) (commitBy, string) {
			token, err := r.x.token(ctx, saver.User)
			if err != nil {
				return commitBy{}, err.Error()
			}
			return commitBy{saver, token, withCoAuthors(text, e, saver)}, ""
		})
	})
}

// autoCommitNow commits by itself, if there is anything to commit and everyone whose edits it contains may
// push to the branch (asked afresh, with each one's own token: so each must still be signed in), and tells
// everyone how it went. The commit is by prefer if they edited, else by whoever made the most edits, with
// a message naming the editors and files. Skipped, the changes stay in the room and the reason is a failed
// commit.
func (r *room) autoCommitNow(prefer collab.User) {
	if r.disposed.Load() || !r.hasChanges() {
		return
	}
	result := r.run(func() message {
		m := r.commitNow(r.x.ctx, func(e editors, paths []string) (commitBy, string) {
			by, skipped := r.autoCommitter(e, prefer)
			if skipped != "" {
				r.x.log.Info().Str("project", r.project).Str("branch", r.branch).Msg(skipped)
				return commitBy{}, skipped
			}
			by.text = automaticMessage(e, paths, by.author)
			return by, ""
		})
		m.Automatic = m.Type == msgSaved
		return m
	})
	if result.Type != msgUnchanged {
		r.host.BroadcastStateless(result.json())
	}
}

// autoCommitter is who commits the edits e by itself (prefer if they edited, else who edited most), or why
// nobody may ("": someone may): someone who made them may not push to the branch, is not signed in any
// more, or is not known, or GitLab cannot be asked.
func (r *room) autoCommitter(e editors, prefer collab.User) (commitBy, string) {
	people := e.people()
	if len(people) == 0 {
		return commitBy{}, fmt.Sprintf("Auto-save skipped: who edited is not known; someone who may push to %s must save.", r.branch)
	}
	for _, p := range people {
		a, err := r.x.access(r.x.ctx, p.User, r.project, r.branch, false)
		var refusal collab.Refusal
		switch {
		case err == errSignedOut:
			return commitBy{}, fmt.Sprintf("Auto-save skipped: %s is not signed in; someone who may push to %s must save.", p.Name, r.branch)
		case err != nil && !errors.As(err, &refusal):
			return commitBy{}, fmt.Sprintf("Auto-save skipped: cannot ask GitLab whether %s may push to %s (%s).", p.Name, r.branch, failureMessage(err))
		case err != nil || !a.Edit || !a.Push:
			return commitBy{}, fmt.Sprintf("Auto-save skipped: %s may not push to %s; someone who may push must save.", p.Name, r.branch)
		}
	}
	author := e.mostEdits()
	if p := e.find(prefer); p != nil {
		author = p
	}
	token, err := r.x.token(r.x.ctx, author.User)
	if err != nil {
		return commitBy{}, fmt.Sprintf("Auto-save skipped: %s is not signed in; someone who may push to %s must save.", author.Name, r.branch)
	}
	return commitBy{author: *author, token: token}, ""
}

// hasEditsBy is whether user made edits the branch does not have yet.
func (r *room) hasEditsBy(user collab.User) bool {
	found := false
	r.host.Do(func(*ydoc.Doc) { found = r.editors.find(user) != nil })
	return found && r.hasChanges()
}

// pullAs merges upstream changes into the room with user's token and tells the clients; without a token
// (or when GitLab cannot be reached) the room stays stale for the next join.
func (r *room) pullAs(ctx context.Context, user collab.User) {
	token, err := r.x.token(ctx, user)
	if err != nil {
		r.stale.Store(true)
		return
	}
	r.pullWith(ctx, token)
}

// pullWith merges upstream changes into the room with token and tells the clients.
func (r *room) pullWith(ctx context.Context, token string) {
	result, err := r.pull(ctx, token)
	r.logErr(err, "cannot merge the push")
	if err != nil {
		r.stale.Store(true)
	}
	if result != nil {
		r.host.BroadcastStateless(result.json())
	}
}

// pull merges upstream changes of the branch into the room (nil: there were none).
func (r *room) pull(ctx context.Context, token string) (*message, error) {
	var result *message
	var err error
	r.run(func() message {
		var b *base
		if !r.host.Do(func(doc *ydoc.Doc) { b = readMeta(doc) }) || b == nil {
			err = errGone
			return message{}
		}
		var head string
		if head, err = r.repo.Head(ctx, token, r.branch); err != nil || head == b.Sha {
			return message{}
		}
		var m message
		if m, err = r.merge(head); err == nil {
			result = &m
		}
		return m
	})
	return result, err
}

// asset returns the bytes of one of the room's other files (false: no such file).
func (r *room) asset(path string) ([]byte, bool, error) {
	var value any
	if !r.host.Do(func(doc *ydoc.Doc) { value = doc.Values(assetsMap)[path] }) {
		return nil, false, nil
	}
	switch v := value.(type) {
	case []byte:
		return v, true, nil
	case string:
		blobs, err := r.repo.Blobs([]string{v})
		if err != nil {
			return nil, false, err
		}
		return blobs[0], true, nil
	}
	return nil, false, nil
}

// hasChanges is whether the room has changes its branch has not.
func (r *room) hasChanges() bool {
	changed := false
	r.host.Do(func(doc *ydoc.Doc) {
		if b := readMeta(doc); b != nil {
			changed = len(commitActions(b, readFiles(doc))) > 0
		}
	})
	return changed
}

// run runs op after the operations before it; then tells the room's changes.
func (r *room) run(op func() message) message {
	r.ops.Lock()
	defer r.ops.Unlock()
	defer r.host.Do(r.tellChanges)
	return op()
}

// updated is a change of the document: an edit, unless the room made it. On the host's goroutine.
func (r *room) updated(_ []byte, origin any) {
	if origin == r {
		return
	}
	r.editors.edited(r.x.editorOf(origin), r.x.clock.Now().UnixMilli())
	if r.changesTimer == nil {
		r.changesTimer = r.x.clock.AfterFunc(changesDelay, func() { r.x.task(func() { r.host.Do(r.tellChanges) }) })
	}
	if r.idleTimer != nil {
		r.idleTimer()
		r.idleTimer = nil
	}
	if after := r.autoCommit(); after > 0 {
		r.idleTimer = r.x.clock.AfterFunc(after, func() { r.x.task(func() { r.autoCommitNow(collab.User{}) }) })
	}
}

// autoCommit is the time without edits after which the room commits by itself (0: never).
func (r *room) autoCommit() time.Duration { return r.x.autoCommitOf(r.name) }

// writeAutoCommit writes the auto-commit time into meta.autoCommit (in minutes; null: never).
func (r *room) writeAutoCommit(doc *ydoc.Doc) error {
	var minutes any
	if after := r.autoCommit(); after > 0 {
		minutes = after.Minutes()
	}
	return r.write(doc, func(w *ydoc.Writer) { w.Set(metaMap, metaAutoCommit, minutes) })
}

// autoCommitChanged: SetAutoCommit changed the setting. The clients learn it; turned off, a pending commit
// by itself is dropped (turned on, the next edit starts one). On the host's goroutine.
func (r *room) autoCommitChanged(doc *ydoc.Doc) {
	if r.autoCommit() == 0 && r.idleTimer != nil {
		r.idleTimer()
		r.idleTimer = nil
	}
	r.logErr(r.writeAutoCommit(doc), "cannot write the auto-commit setting")
}

// tellChanges writes what the room has that the branch has not into meta.changes (if that changed).
func (r *room) tellChanges(doc *ydoc.Doc) {
	if r.changesTimer != nil {
		r.changesTimer()
		r.changesTimer = nil
	}
	b := readMeta(doc)
	if r.disposed.Load() || b == nil {
		return
	}
	files := changedFiles(commitActions(b, readFiles(doc)))
	var changes *roomChanges
	if len(files) == 0 {
		r.editors.take() // edits that were undone, or committed meanwhile
	} else {
		if r.editors.since == 0 {
			r.editors.since = r.x.clock.Now().UnixMilli()
		}
		changes = &roomChanges{Files: files, Since: r.editors.since, Editors: r.editors.names(), EditorIDs: r.editors.userIDs()}
	}
	var stored *roomChanges
	if s := new(roomChanges); readValue(doc, metaChanges, s) {
		stored = s
	}
	if reflect.DeepEqual(changes, stored) {
		return
	}
	r.logErr(r.write(doc, func(w *ydoc.Writer) { w.Set(metaMap, metaChanges, plain(changes)) }), "cannot write the changes")
}

// commitNow commits as commitAttempts does. A failure (the repository unreachable or refusing the commit)
// is the outcome and stays in meta.commitFailure for everyone (also who joins later) until the next commit
// or merge.
func (r *room) commitNow(ctx context.Context, compose compose) message {
	result, err := r.commitAttempts(ctx, compose)
	if err != nil {
		result = message{Type: msgError, Message: failureMessage(err)}
	}
	if result.Type == msgError {
		failure := commitFailure{Message: result.Message, At: r.x.clock.Now().UnixMilli()}
		r.host.Do(func(doc *ydoc.Doc) {
			r.logErr(r.write(doc, func(w *ydoc.Writer) { w.Set(metaMap, metaFailure, plain(failure)) }), "cannot write the failure")
		})
	}
	return result
}

// compose is who commits the edits e, which change the files at paths, and the commit message; or why
// there is no commit (refused: not "").
type compose func(e editors, paths []string) (by commitBy, refused string)

// commitBy is a commit's author, with their token, and its message.
type commitBy struct {
	author person
	token  string
	text   string
}

// commitAttempts tries until a commit is done or a conflict ends it.
func (r *room) commitAttempts(ctx context.Context, compose compose) (message, error) {
	for range saveAttempts {
		result, done, err := r.commit(ctx, compose)
		if err != nil || done {
			return result, err
		}
	}
	return message{Type: msgError, Message: "The branch keeps changing; try again."}, nil
}

// commit is one attempt: the outcome, or not done after merging an upstream that moved (try again).
func (r *room) commit(ctx context.Context, compose compose) (result message, done bool, err error) {
	var b *base
	var files roomFiles
	var actions []Action
	var edits editors
	gone := !r.host.Do(func(doc *ydoc.Doc) {
		if b = readMeta(doc); b == nil {
			return
		}
		files = readFiles(doc)
		if actions = commitActions(b, files); len(actions) > 0 {
			edits = r.editors.take() // the edits in files; edits made while the commit runs stay for the next one
		}
	})
	if gone {
		return message{}, true, errGone
	}
	if len(actions) == 0 {
		return message{Type: msgUnchanged}, true, nil
	}
	if refused := r.outsideFolder(actions); refused != "" {
		r.host.Do(func(*ydoc.Doc) { r.editors.restore(edits) })
		return message{Type: msgError, Message: refused}, true, nil
	}
	var paths []string
	for _, f := range changedFiles(actions) {
		paths = append(paths, f.Path)
	}
	by, refused := compose(edits, paths)
	if refused != "" {
		r.host.Do(func(*ydoc.Doc) { r.editors.restore(edits) })
		return message{Type: msgError, Message: refused}, true, nil
	}
	sha, err := r.repo.Commit(ctx, by.token, CommitRequest{
		Branch: r.branch, ExpectedHead: b.Sha, Message: by.text, Actions: actions,
		Author: Signature{Name: by.author.Name, Email: by.author.Email},
	})
	if err != nil {
		r.host.Do(func(*ydoc.Doc) { r.editors.restore(edits) })
		if !errors.Is(err, ErrConflict) {
			return message{}, true, err
		}
		head, err := r.repo.Head(ctx, by.token, r.branch)
		if err != nil {
			return message{}, true, err
		}
		merged, err := r.merge(head)
		return merged, err != nil || merged.Type == msgConflict, err
	}
	r.host.Do(func(doc *ydoc.Doc) { r.committed(doc, b, files, sha) })
	return message{Type: msgSaved, Sha: sha, Author: by.author.Name}, true, nil
}

// merge merges the branch at head (fetched before) into the room (see applyMerge).
func (r *room) merge(head string) (message, error) {
	var pulled []string
	if !r.host.Do(func(doc *ydoc.Doc) { pulled = readPulledIn(doc) }) {
		return message{}, errGone
	}
	upstream, err := r.snapshot(head, pulled)
	if err != nil {
		return message{}, err
	}
	var result message
	if !r.host.Do(func(doc *ydoc.Doc) { result = r.applyMerge(doc, upstream) }) {
		return message{}, errGone
	}
	return result, nil
}

// applyMerge merges upstream into the room: per file three-way (base vs upstream vs room), applied as small
// Y.Text edits. On a conflict nothing changes but meta.conflict, and the conflict is the result.
func (r *room) applyMerge(doc *ydoc.Doc, upstream base) message {
	b := readMeta(doc)
	current := readFiles(doc)
	changes, conflicts := mergeFiles(b.Texts, current.texts, upstream.Texts)
	if len(conflicts) > 0 {
		conflict := roomConflict{Sha: upstream.Sha}
		for _, c := range conflicts {
			conflict.Paths = append(conflict.Paths, c.Path)
		}
		// the repository answered: the conflict is what keeps the changes from it now
		r.logErr(r.write(doc, func(w *ydoc.Writer) {
			w.Set(metaMap, metaConflict, plain(conflict))
			if doc.Values(metaMap)[metaFailure] != nil {
				w.Set(metaMap, metaFailure, nil)
			}
		}), "cannot write the conflict")
		return message{Type: msgConflict, Sha: upstream.Sha, Files: conflicts}
	}
	r.logErr(r.write(doc, func(w *ydoc.Writer) {
		for path, text := range changes {
			old, exists := current.texts[path]
			switch {
			case text == nil:
				w.Delete(filesMap, path)
			case !exists:
				w.SetText(filesMap, path, *text)
			default:
				for _, e := range slices.Backward(textEdits(old, *text)) {
					w.Edit(filesMap, path, e.From, e.To, e.Insert)
				}
			}
		}
		mergeAssets(w, b.Assets, current.assets, upstream.Assets)
		writeBase(w, doc, upstream)
	}), "cannot write the merge")
	return message{Type: msgMerged, Sha: upstream.Sha}
}

// mergeAssets takes upstream's changes to other files where the room did not change them (else the room's
// version stays).
func mergeAssets(w *ydoc.Writer, base map[string]string, current map[string]any, upstream map[string]string) {
	paths := map[string]bool{}
	for _, m := range []map[string]string{base, upstream} {
		for p := range m {
			paths[p] = true
		}
	}
	for path := range paths {
		b, inBase := base[path]
		u, inUpstream := upstream[path]
		c, inCurrent := current[path]
		cs, isString := c.(string)
		unchanged := inCurrent == inBase && (!inCurrent || (isString && cs == b))
		if same(u, inUpstream, b, inBase) || !unchanged {
			continue
		}
		if inUpstream {
			w.Set(assetsMap, path, u)
		} else {
			w.Delete(assetsMap, path)
		}
	}
}

// committed: files were committed as sha. They are the new base; uploads become repository files.
func (r *room) committed(doc *ydoc.Doc, b *base, files roomFiles, sha string) {
	known := map[string]bool{}
	for _, s := range b.Assets {
		known[s] = true
	}
	assets := map[string]string{}
	now := doc.Values(assetsMap)
	r.logErr(r.write(doc, func(w *ydoc.Writer) {
		for path, value := range files.assets {
			switch v := value.(type) {
			case string:
				if known[v] {
					assets[path] = v
				}
			case []byte:
				assets[path] = blobSha(v)
				if still, ok := now[path].([]byte); ok && bytes.Equal(still, v) {
					w.Set(assetsMap, path, assets[path])
				}
			}
		}
		writeBase(w, doc, base{Sha: sha, Texts: files.texts, Assets: assets})
	}), "cannot write the commit")
}

// snapshot reads the room's files of the repository at sha (fetched before): those in its folder and the
// pulled-in ones, .typ files as text, the others by blob sha.
func (r *room) snapshot(sha string, pulled []string) (base, error) {
	entries, err := r.repo.Tree(sha)
	if err != nil {
		return base{}, err
	}
	snapshot := base{Sha: sha, Texts: map[string]string{}, Assets: map[string]string{}}
	var typst, shas []string
	for _, e := range entries {
		switch {
		case !r.inFolder(e.Path) && !slices.Contains(pulled, e.Path):
		case strings.HasSuffix(e.Path, ".typ"):
			typst, shas = append(typst, e.Path), append(shas, e.Sha)
		default:
			snapshot.Assets[e.Path] = e.Sha
		}
	}
	contents, err := r.repo.Blobs(shas)
	if err != nil {
		return base{}, err
	}
	for i, path := range typst {
		snapshot.Texts[path] = decodeText(contents[i])
	}
	return snapshot, nil
}

// decodeText is a file's text as the browser's TextDecoder reads it: without a byte order mark, invalid
// bytes as U+FFFD.
func decodeText(content []byte) string {
	text := strings.TrimPrefix(string(content), "\uFEFF")
	if !utf8.ValidString(text) {
		text = strings.ToValidUTF8(text, "\uFFFD")
	}
	return text
}

// readFiles reads the room's files: texts, and assets as blob sha or uploaded bytes.
func readFiles(doc *ydoc.Doc) roomFiles {
	files := roomFiles{texts: doc.Texts(filesMap), assets: map[string]any{}}
	for path, value := range doc.Values(assetsMap) {
		switch value.(type) {
		case string, []byte:
			files.assets[path] = value
		}
	}
	return files
}

// write makes the room's own change of the document (not an edit by anyone).
func (r *room) write(doc *ydoc.Doc, fn func(w *ydoc.Writer)) error { return doc.Write(r, fn) }

func (r *room) logErr(err error, msg string) {
	if err != nil && !errors.Is(err, errGone) {
		r.x.log.Error().Err(err).Str("project", r.project).Str("branch", r.branch).Msg(msg)
	}
}

// failureMessage is what went wrong talking to GitLab: its answer, why the room could not ask, or that it
// could not be reached.
func failureMessage(err error) string {
	var refused *APIError
	var refusal collab.Refusal
	switch {
	case errors.As(err, &refused):
		return refused.Message
	case errors.As(err, &refusal):
		return refusal.Reason
	case errors.Is(err, errTooLarge), errors.Is(err, errBadPath):
		return err.Error()
	}
	return fmt.Sprintf("GitLab could not be reached (%v)", err)
}

const (
	// nobody is the committer of every commit, and the name of an editor who names nobody
	nobody               = "Zwiebelfisch"
	defaultCommitMessage = "Edit via Zwiebelfisch"
	// changesDelay is the time between an edit and meta.changes telling it (edits within it are told together)
	changesDelay = 500 * time.Millisecond
	// saveAttempts is how often a save merges upstream and tries again when the branch keeps moving
	saveAttempts = 3
	// maxPulledIn is how many files from outside its folder a room holds at most
	maxPulledIn = 200
)
