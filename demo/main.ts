import { createTypstEditor } from '../src';

const source = `#set page(width: 16cm, height: auto, margin: 1.5cm)
#set text(font: "Libertinus Serif", size: 12pt)

= Hello Typst

This is *bold* and _emphasised_ text. Click anything in the preview to jump to its source.

- first item
- second item

$ sum_(k=1)^n k = (n(n+1)) / 2 $
`;

const params = new URLSearchParams(location.search);
// `?files` opens a small multi-file project to try the file bar.
const multiFile = params.has('files');
// `?room=<name>` edits together with everyone in that room, through the local
// collaboration server (`mise run server:dev`); `&user=<name>` sets the name others see.
const room = params.get('room');
const user = { name: params.get('user') ?? (room ? `Guest ${Math.floor(Math.random() * 1000)}` : 'Demo user') };
const files: Record<string, string> = multiFile
  ? { '/chapter1.typ': '= Chapter 1\n\nThis text lives in `chapter1.typ`. Click it in the preview.\n' }
  : {};
const editor = createTypstEditor(document.getElementById('editor')!, {
  source: multiFile ? `${source}\n#include "chapter1.typ"\n` : source,
  files,
  user,
  collaboration: room ? { url: 'ws://127.0.0.1:1234', room } : undefined,
});
Object.assign(window, { editor });
