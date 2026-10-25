= Start page <features-start-page>

#import "../template.typ": unreviewed
#unreviewed
#set heading(outlined: false)

Opening Zwiebelfisch's address shows the start page: your projects, as IntelliJ's welcome screen or CodiMD's overview. Signed out, it only says "Sign in with GitLab". The deployment that serves it: @configuration-deployment.

```
┌─ Zwiebelfisch ─────────────────────────────────────────── Sebastian ▾ ─┐
│  [ Search GitLab projects, or paste a GitLab URL …                 ]   │
│                                                                        │
│  OPEN NOW                                                              │
│   sandstorm/angebote · feature-x · /2026/q1       ● Anna, Ben          │
│  PINNED                                                                │
│   📌👥 sandstorm/angebote · main · /2026/q1   pinned for the team      │
│   📌   sandstorm/handbuch · main                                       │
│  RECENT                                                                │
│   sandstorm/angebote · main · /2026/q1            2 h ago      📌  ✕   │
└────────────────────────────────────────────────────────────────────────┘
```

*Find a project:* type in the search field. It completes from every GitLab project you may edit (Developer or more). Pasting a GitLab URL (`https://gitlab.example.org/group/project/-/tree/main/2026/q1`) opens that branch and folder at once.

*Open now:* the projects others are editing right now, with who is in. A click joins them. The list follows every 10 seconds.

*Recent:* the projects you opened, newest first, on every device you sign in on. ✕ takes one off the list.

*Pin:* 📌 keeps a project at the top, for you. "Pin for the team" (Maintainers of the GitLab project) shows it pinned to everyone who may edit the project.

*Open:* picking a project asks for the branch (the default one preselected) and the project in it: a folder with a `main.typ`, the first one preselected. "← Projects" in the editor's title bar leads back here.

== A new project <features-start-page-new-project>

"New" in the same dialog makes a folder, e.g. `/2026/q3`, from a template. Nothing reaches GitLab until you save, as with any edit (@features-gitlab); closing it unsaved leaves no trace.

*Templates* are folders in the repository. From the new folder's parent up to the repository's root, each folder may hold:
- `_template/`: one template, named after the folder holding it
- `_templates/<name>/`: one template per subfolder

The nearest come first; "Empty" (one `main.typ`) is always there. The template's files are copied exactly as they are. Imports with absolute paths (`#import "/template.typ"`) keep working; relative ones that leave the template folder do not. Folders starting with `_` are no projects.
