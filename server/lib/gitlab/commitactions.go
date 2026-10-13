package gitlab

import (
	"maps"
	"slices"
	"sort"
	"strings"
)

// roomFiles are the room's files as they are now: .typ texts, and the other files (assets) as a blob sha
// (string, a repository file) or []byte (uploaded, not committed yet).
type roomFiles struct {
	texts  map[string]string
	assets map[string]any
}

// commitActions are the actions of one commit that turns the repository at b into files: updates,
// creations, deletions, and moves (a deleted file paired with a created one of similar content, like git's
// rename detection).
func commitActions(b *base, files roomFiles) []Action {
	return append(textActions(b.Texts, files.texts), assetActions(b.Assets, files.assets)...)
}

// changedFiles are the files a commit of actions changes, by path (a move: its old path deleted, its new
// one added).
func changedFiles(actions []Action) []changedFile {
	kinds := map[ActionKind]string{ActionCreate: "added", ActionUpdate: "modified", ActionDelete: "deleted", ActionMove: "added"}
	var files []changedFile
	for _, a := range actions {
		files = append(files, changedFile{Path: a.Path, Kind: kinds[a.Kind]})
		if a.Kind == ActionMove {
			files = append(files, changedFile{Path: a.PreviousPath, Kind: "deleted"})
		}
	}
	sort.SliceStable(files, func(i, j int) bool { return files[i].Path < files[j].Path })
	return files
}

func textActions(base, texts map[string]string) []Action {
	var actions []Action
	var created, deleted []string
	for _, path := range slices.Sorted(maps.Keys(texts)) {
		old, ok := base[path]
		switch {
		case !ok:
			created = append(created, path)
		case old != texts[path]:
			actions = append(actions, Action{Kind: ActionUpdate, Path: path, Content: []byte(texts[path]), Text: true})
		}
	}
	for _, path := range slices.Sorted(maps.Keys(base)) {
		if _, ok := texts[path]; !ok {
			deleted = append(deleted, path)
		}
	}
	for _, pair := range pairRenames(deleted, created, func(from, to string) float64 { return similarity(base[from], texts[to]) }) {
		actions = append(actions, Action{Kind: ActionMove, Path: pair[1], PreviousPath: pair[0], Content: []byte(texts[pair[1]]), Text: true})
		deleted = slices.DeleteFunc(deleted, func(p string) bool { return p == pair[0] })
		created = slices.DeleteFunc(created, func(p string) bool { return p == pair[1] })
	}
	for _, path := range created {
		actions = append(actions, Action{Kind: ActionCreate, Path: path, Content: []byte(texts[path]), Text: true})
	}
	for _, path := range deleted {
		actions = append(actions, Action{Kind: ActionDelete, Path: path})
	}
	return actions
}

// pairRenames pairs deleted and created paths whose contents are similar enough to call it a rename, best
// pairs first.
func pairRenames(deleted, created []string, score func(from, to string) float64) [][2]string {
	type candidate struct {
		from, to string
		score    float64
	}
	var candidates []candidate
	for _, from := range deleted {
		for _, to := range created {
			candidates = append(candidates, candidate{from, to, score(from, to)})
		}
	}
	sort.SliceStable(candidates, func(i, j int) bool { return candidates[i].score > candidates[j].score })
	var pairs [][2]string
	used := map[string]bool{}
	for _, c := range candidates {
		if c.score < renameThreshold || used[c.from] || used[c.to] {
			continue
		}
		used[c.from], used[c.to] = true, true
		pairs = append(pairs, [2]string{c.from, c.to})
	}
	return pairs
}

// renameThreshold is git's default: at least half the content is the same.
const renameThreshold = 0.5

// similarity is how much of two texts' lines they share (0..1; identical texts 1, also when empty).
func similarity(a, b string) float64 {
	if a == b {
		return 1
	}
	left, right := strings.Split(a, "\n"), strings.Split(b, "\n")
	counts := map[string]int{}
	for _, line := range left {
		counts[line]++
	}
	shared := 0
	for _, line := range right {
		if counts[line] > 0 {
			shared++
			counts[line]--
		}
	}
	return 2 * float64(shared) / float64(len(left)+len(right))
}

func assetActions(base map[string]string, assets map[string]any) []Action {
	var actions []Action
	var deleted []string
	for _, path := range slices.Sorted(maps.Keys(base)) {
		if _, ok := assets[path]; !ok {
			deleted = append(deleted, path)
		}
	}
	for _, path := range slices.Sorted(maps.Keys(assets)) {
		old, inBase := base[path]
		switch value := assets[path].(type) {
		case []byte:
			if old == blobSha(value) {
				continue
			}
			kind := ActionCreate
			if inBase {
				kind = ActionUpdate
			}
			actions = append(actions, Action{Kind: kind, Path: path, Content: value})
		case string:
			if old == value {
				continue
			}
			// a repository file under a new path: a rename (moved without new content)
			if i := slices.IndexFunc(deleted, func(p string) bool { return base[p] == value }); i >= 0 {
				actions = append(actions, Action{Kind: ActionMove, Path: path, PreviousPath: deleted[i]})
				deleted = slices.Delete(deleted, i, i+1)
			}
		}
	}
	for _, path := range deleted {
		actions = append(actions, Action{Kind: ActionDelete, Path: path})
	}
	return actions
}
