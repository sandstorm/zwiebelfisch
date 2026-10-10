import { createTypstEditor } from '../src';

const source = `#set page(width: 16cm, height: auto, margin: 1.5cm)
#set text(font: "Libertinus Serif", size: 12pt)

= Hello Typst

This is *bold* and _emphasised_ text. Click anything in the preview to jump to its source.

- first item
- second item

$ sum_(k=1)^n k = (n(n+1)) / 2 $
`;

const editor = createTypstEditor(document.getElementById('editor')!, { source });
Object.assign(window, { editor });
