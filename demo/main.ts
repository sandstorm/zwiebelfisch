import { createTypstEditor } from '../src';

const source = `#set page(width: 16cm, height: auto, margin: 1.5cm)
#set text(font: "Libertinus Serif", size: 12pt)

= Hello Typst

This is *bold* and _emphasised_ text. Click anything in the preview to jump to its source.

- first item
- second item

$ sum_(k=1)^n k = (n(n+1)) / 2 $
`;

// `?files` opens a small multi-file project to try the file bar.
const multiFile = new URLSearchParams(location.search).has('files');
const files: Record<string, string> = multiFile
  ? { '/chapter1.typ': '= Chapter 1\n\nThis text lives in `chapter1.typ`. Click it in the preview.\n' }
  : {};
const editor = createTypstEditor(document.getElementById('editor')!, {
  source: multiFile ? `${source}\n#include "chapter1.typ"\n` : source,
  files,
  user: { name: 'Demo user' },
});
Object.assign(window, { editor });
