= Local folders <features-local-folders>

#import "../template.typ": unreviewed
#unreviewed
#set heading(outlined: false)

`zwiebelfisch [file or folder]` edits a project on your machine, like `idea .`: it opens the browser on the folder (`.` without one), and every change goes straight to its files. Changes made on disk show up within a second. No sign-in, no git. In a repository, what `.gitignore` leaves out stays out, and a file Typst rarely uses (`read("main.go")`) comes when a compile asks for it. `zwiebelfisch serve` is the collaboration server.
