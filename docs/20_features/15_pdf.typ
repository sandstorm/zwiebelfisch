= PDF <features-pdf>
#set heading(outlined: false)

== What it does

#import "../template.typ": screenshot
#screenshot("pdf")

"Download PDF" in the preview toolbar opens the export options; "Download" saves the document as a PDF, named after the main file (`main.pdf`).

- "Include comments": off, the final version, notes removed (a range note keeps its text); on, the margin notes as the preview shows them (@features-comments). Choices are kept for the browser session.
- With errors there is no PDF; a message says why.

== How to configure

- `pdfExport.download` (on by default): the "Download PDF" button (@reference-configuration-pdf).
- Export option `comments.include` (off by default).
- A host exports without the button: `editor.exportPdf(options)` or the command `pdfExport.export` (@reference-embedding-pdf).
