package gitlab

import (
	"context"
	"strconv"
	"testing"

	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"

	"github.com/sandstorm/zwiebelfisch/server/lib/collab"
	"github.com/sandstorm/zwiebelfisch/server/lib/fakegitlab"
)

// Who may edit and save: GitLab's answers to the user's own token (against the fake GitLab, which answers
// members and branches as GitLab does), and what Rooms make of them.

func TestAccessFromGitLab(t *testing.T) {
	fake := fakegitlab.New("group/report", fakegitlab.Files{"/main.typ": []byte("= Report\n")})
	gitlab := api{instance: fakegitlab.URL, client: fake.Client()}
	fake.SetAutoBranches(true)
	stranger := fake.SetAccess("Stranger", fakegitlab.NoAccess)
	reporter := fake.SetAccess("Rita", fakegitlab.Reporter)
	developer := fake.SetAccess("Dev", fakegitlab.Developer)
	maintainer := fake.SetAccess("Mai", fakegitlab.Maintainer)
	fake.Protect("main", fakegitlab.Maintainer)
	fake.Protect("release/*", fakegitlab.NoAccess, "Dev")
	access := func(u fakegitlab.User, branch string) Access {
		a, err := gitlab.userAccess(context.Background(), fake.TokenOf(u.Name), "group/report", branch, strconv.Itoa(u.ID))
		require.NoError(t, err)
		return a
	}

	require.Equal(t, Access{}, access(stranger, "main"), "not a member")
	require.Equal(t, Access{}, access(fakegitlab.User{ID: 999, Name: "Nobody"}, "main"), "no such user")
	require.Equal(t, Access{Role: "Reporter"}, access(reporter, "draft"))
	require.Equal(t, Access{Role: "Developer", Edit: true, Push: true}, access(developer, "draft"), "unprotected")
	require.Equal(t, Access{Role: "Developer", Edit: true}, access(developer, "main"), "protected: Maintainers push")
	require.Equal(t, Access{Role: "Maintainer", Edit: true, Push: true, Maintain: true}, access(maintainer, "main"))
	require.Equal(t, Access{Role: "Developer", Edit: true, Push: true}, access(developer, "release/1.0"), "a wildcard rule naming the user")
	require.Equal(t, Access{Role: "Maintainer", Edit: true, Maintain: true}, access(maintainer, "release/1.0"), "No one by role")

	_, err := gitlab.userAccess(context.Background(), "forged", "group/report", "main", strconv.Itoa(developer.ID))
	require.ErrorContains(t, err, "401")
}

func TestAuthorize(t *testing.T) {
	repo := newFakeRepo(initialFiles())
	clock := &fakeClock{now: atTen}
	tokens := &fakeTokens{}
	x := New(Options{Log: zerolog.Nop(), Token: tokens.Token, repository: func(string) Repository { return repo }, access: repo.Access, clock: clock})
	defer x.Close()
	ctx := context.Background()
	user := func(id string) collab.User { return collab.User{Provider: DefaultID, ID: id, Name: "U" + id} }

	require.NoError(t, x.Authorize(ctx, user("7"), roomName))
	require.Equal(t, []string{"token-7"}, repo.usedTokens(), "asked with the user's own token")
	require.EqualError(t, x.Authorize(ctx, collab.User{Provider: "oidc", ID: "7"}, roomName), "Sign in with GitLab to open GitLab projects.")
	tokens.signOut("11")
	require.EqualError(t, x.Authorize(ctx, user("11"), roomName), "Sign in with GitLab again.")
	require.EqualError(t, x.Authorize(ctx, collab.User{}, roomName), "Sign in with GitLab to open GitLab projects.")

	repo.setAccess("8", Access{})
	require.EqualError(t, x.Authorize(ctx, user("8"), roomName), "You are not a member of group/report on GitLab.")
	repo.setAccess("9", Access{Role: "Reporter"})
	err := x.Authorize(ctx, user("9"), roomName)
	require.ErrorAs(t, err, new(collab.Refusal), "a reason the widget shows")
	require.EqualError(t, err, "Editing group/report needs the Developer role on GitLab; you are Reporter.")

	t.Run("joins rely on an answer for a minute; a save asks again", func(t *testing.T) {
		require.NoError(t, x.Authorize(ctx, user("7"), roomName))
		require.Equal(t, 1, repo.count("access 7 main"))
		repo.setAccess("7", Access{Role: "Developer", Edit: true})
		require.EqualError(t, x.mayPush(ctx, user("7"), projectPath, "main"), "main is protected and you may not push to it.")
		require.Equal(t, 2, repo.count("access 7 main"))
		repo.setAccess("7", Access{Role: "Reporter"})
		require.NoError(t, x.Authorize(ctx, user("7"), roomName), "cached")
		clock.Advance(accessTTL)
		require.Error(t, x.Authorize(ctx, user("7"), roomName), "asked again")
	})

	t.Run("GitLab unreachable: refused with the reason", func(t *testing.T) {
		repo.mu.Lock()
		repo.unreachable = true
		repo.mu.Unlock()
		require.EqualError(t, x.Authorize(ctx, user("10"), roomName), "Cannot check your access on GitLab: GitLab could not be reached (fetch failed)")
	})
}
