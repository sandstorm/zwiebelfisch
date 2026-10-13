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

	"typst-editor/server/lib/collab"
	"typst-editor/server/lib/ydoc"
)

// room is one room backed by a branch: it loads the branch into the room's document, commits the room's
// changes (on a save, or by itself when nobody edited for a while or the last user left) and merges
// upstream pushes into it.
//
// The document holds the .typ files (files), the other files (assets) and the commit they are based on
// (meta, see protocol.go). Everyone in the room sees that state: what is not committed yet and by whom
// (changes), a conflict with upstream (conflict, until a merge succeeds) and a failed commit
// (commitFailure, until the next commit or merge). Everything the room knows lives in the document, so a
// room stored and loaded again continues where it was; only the count of edits per editor starts over.
//
// Every change of the document but the room's own is an edit by someone; a commit names the editors as
// co-authors (its author is the bot the repository credentials belong to). Operations (save, pull, commit
// by itself) run one after another; repository calls run outside the room's goroutine, so clients keep
// editing meanwhile, and the document is read and written through the host (collab.Room.Do).
type room struct {
	x       *Rooms
	host    host
	repo    Repository
	name    string
	project string
	branch  string

	ops      sync.Mutex // one operation at a time
	disposed atomic.Bool

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
}

// errGone: the room unloaded while an operation ran.
var errGone = errors.New("gitlab: the room was unloaded")

// open loads the branch into a room that has no base yet; brings a stored room up to date with upstream
// instead (or opens it as it is when the repository cannot be reached; the next pull or save catches up).
// Called on the host's goroutine, before anyone joins.
func (r *room) open(ctx context.Context, doc *ydoc.Doc) error {
	var stored roomChanges
	if readValue(doc, metaChanges, &stored) {
		r.editors.since = stored.Since
		for _, name := range stored.Editors {
			r.editors.edited(&person{name, r.x.authorEmail}, stored.Since)
			r.editors.by[name].edits = 0
		}
	}
	if err := r.writeAutoCommit(doc); err != nil {
		return err
	}
	if b := readMeta(doc); b != nil {
		if head, err := r.repo.Head(ctx, r.branch); err == nil && head != b.Sha {
			if upstream, err := r.snapshot(ctx, head); err == nil {
				r.applyMerge(doc, upstream)
			}
		}
	} else {
		head, err := r.repo.Head(ctx, r.branch)
		if err != nil {
			return err
		}
		snapshot, err := r.snapshot(ctx, head)
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

// Stateless handles a client's save (gitlab:save), if the client's user may push to the branch: the
// outcome goes to everyone, or (nothing to commit, an error, a refusal) to the saving client only.
func (r *room) Stateless(p *collab.Peer, payload string) {
	user := p.User()
	name, text, ok := parseSave(user, payload)
	if !ok {
		return
	}
	r.x.goTask(func() {
		if err := r.x.mayPush(r.x.ctx, user, r.project, r.branch); err != nil {
			p.SendStateless(message{Type: msgError, Message: err.Error()}.json())
			return
		}
		result := r.save(r.x.ctx, name, text)
		if result.Type == msgUnchanged || result.Type == msgError {
			p.SendStateless(result.json())
		} else {
			r.host.BroadcastStateless(result.json())
		}
	})
}

// parseSave reads a save (gitlab:save) by user: who saves (the user, else whom the client names) and the
// commit message (default "Edit via Typst editor").
func parseSave(user collab.User, payload string) (who, text string, ok bool) {
	var m clientMessage
	if json.Unmarshal([]byte(payload), &m) != nil || m.Type != "gitlab:save" {
		return "", "", false
	}
	who = user.Name
	if who == "" && m.Author != nil {
		who = m.Author.Name
	}
	if who == "" {
		who = nobody
	}
	if text = strings.TrimSpace(m.Message); text == "" {
		text = defaultCommitMessage
	}
	return who, text, true
}

// Left: the last user left. With auto-commit, the room commits its changes after leaveDelay, unless
// someone is back by then (a reload).
func (r *room) Left(ctx context.Context) {
	r.x.task(func() {
		if r.autoCommit() == 0 || !r.hasChanges() {
			return
		}
		if !r.x.sleep(ctx, r.x.leaveDelay) || !r.host.Empty() {
			return
		}
		r.autoCommitNow()
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

// save commits the room's changes since its base as one commit, the editors as co-authors; who saved is
// named in the outcome. When upstream moved meanwhile, it merges upstream first and tries again; a
// conflict ends the save.
func (r *room) save(ctx context.Context, who, text string) message {
	return r.run(func() message {
		return r.commitNow(ctx, func(e editors, _ []string) (string, string) { return who, withCoAuthors(text, e) })
	})
}

// autoCommitNow commits by itself, if there is anything to commit, and tells everyone how it went: as
// save does, named after whoever made the most edits, with a message naming the editors and files.
func (r *room) autoCommitNow() {
	if r.disposed.Load() || !r.hasChanges() {
		return
	}
	result := r.run(func() message {
		m := r.commitNow(r.x.ctx, func(e editors, paths []string) (string, string) {
			who := nobody
			if p := e.mostEdits(); p != nil {
				who = p.Name
			}
			return who, automaticMessage(e, paths)
		})
		m.Automatic = m.Type == msgSaved
		return m
	})
	if result.Type != msgUnchanged {
		r.host.BroadcastStateless(result.json())
	}
}

// pull merges upstream changes of the branch into the room (nil: there were none).
func (r *room) pull(ctx context.Context) (*message, error) {
	var result *message
	var err error
	r.run(func() message {
		var b *base
		if !r.host.Do(func(doc *ydoc.Doc) { b = readMeta(doc) }) || b == nil {
			err = errGone
			return message{}
		}
		var head string
		if head, err = r.repo.Head(ctx, r.branch); err != nil || head == b.Sha {
			return message{}
		}
		var m message
		if m, err = r.merge(ctx, head); err == nil {
			result = &m
		}
		return m
	})
	return result, err
}

// asset returns the bytes of one of the room's other files (false: no such file).
func (r *room) asset(ctx context.Context, path string) ([]byte, bool, error) {
	var value any
	if !r.host.Do(func(doc *ydoc.Doc) { value = doc.Values(assetsMap)[path] }) {
		return nil, false, nil
	}
	switch v := value.(type) {
	case []byte:
		return v, true, nil
	case string:
		content, err := r.x.blobs.get(v, func() ([]byte, error) { return r.repo.Blob(ctx, v) })
		return content, err == nil, err
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
		r.idleTimer = r.x.clock.AfterFunc(after, func() { r.x.task(r.autoCommitNow) })
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
		changes = &roomChanges{Files: files, Since: r.editors.since, Editors: r.editors.names()}
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

// compose names who commits (for the outcome) and the commit message, for a commit of edits that changes
// the files at paths.
type compose func(e editors, paths []string) (who, text string)

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
	var paths []string
	for _, f := range changedFiles(actions) {
		paths = append(paths, f.Path)
	}
	who, text := compose(edits, paths)
	c, err := r.repo.Commit(ctx, CommitRequest{Branch: r.branch, ExpectedHead: b.Sha, Message: text, Actions: actions})
	if err != nil {
		r.host.Do(func(*ydoc.Doc) { r.editors.restore(edits) })
		if !errors.Is(err, ErrConflict) {
			return message{}, true, err
		}
		head, err := r.repo.Head(ctx, r.branch)
		if err != nil {
			return message{}, true, err
		}
		merged, err := r.merge(ctx, head)
		return merged, err != nil || merged.Type == msgConflict, err
	}
	r.host.Do(func(doc *ydoc.Doc) { r.committed(doc, b, files, c.Sha) })
	if c.Parent != b.Sha {
		// someone else's commit landed between our base and ours (the repository could not refuse it)
		_, err := r.merge(ctx, c.Sha)
		r.logErr(err, "cannot merge what landed under the commit")
	}
	return message{Type: msgSaved, Sha: c.Sha, Author: who}, true, nil
}

// merge merges the branch at head into the room (see applyMerge).
func (r *room) merge(ctx context.Context, head string) (message, error) {
	upstream, err := r.snapshot(ctx, head)
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
				r.x.blobs.put(assets[path], v)
				if still, ok := now[path].([]byte); ok && bytes.Equal(still, v) {
					w.Set(assetsMap, path, assets[path])
				}
			}
		}
		writeBase(w, doc, base{Sha: sha, Texts: files.texts, Assets: assets})
	}), "cannot write the commit")
}

// snapshot reads the repository at sha: .typ files as text, the other files by blob sha.
func (r *room) snapshot(ctx context.Context, sha string) (base, error) {
	entries, err := r.repo.Tree(ctx, sha)
	if err != nil {
		return base{}, err
	}
	snapshot := base{Sha: sha, Texts: map[string]string{}, Assets: map[string]string{}}
	var typst []TreeEntry
	for _, e := range entries {
		if strings.HasSuffix(e.Path, ".typ") {
			typst = append(typst, e)
		} else {
			snapshot.Assets[e.Path] = e.Sha
		}
	}
	texts := make([]string, len(typst))
	errs := make([]error, len(typst))
	var wg sync.WaitGroup
	limit := make(chan struct{}, parallelReads)
	for i, e := range typst {
		wg.Add(1)
		limit <- struct{}{}
		go func() {
			defer func() { <-limit; wg.Done() }()
			content, err := r.x.blobs.get(e.Sha, func() ([]byte, error) { return r.repo.Blob(ctx, e.Sha) })
			texts[i], errs[i] = decodeText(content), err
		}()
	}
	wg.Wait()
	if err := errors.Join(errs...); err != nil {
		return base{}, err
	}
	for i, e := range typst {
		snapshot.Texts[e.Path] = texts[i]
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

// failureMessage is what went wrong in a commit: the repository's answer, or that it could not be reached.
func failureMessage(err error) string {
	var refused *APIError
	if errors.As(err, &refused) {
		return refused.Message
	}
	return fmt.Sprintf("GitLab could not be reached (%v)", err)
}

const (
	// nobody commits when nobody is known to have edited (a stored room's edits, made before the server
	// started), and saves for a client that names nobody
	nobody               = "Typst editor"
	defaultCommitMessage = "Edit via Typst editor"
	// changesDelay is the time between an edit and meta.changes telling it (edits within it are told together)
	changesDelay = 500 * time.Millisecond
	// saveAttempts is how often a save merges upstream and tries again when the branch keeps moving
	saveAttempts = 3
	// parallelReads bounds the blobs read at once when loading a commit
	parallelReads = 8
)
