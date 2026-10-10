// The empty diagram: what "New diagram…" writes, a valid PNG (one transparent pixel, so Typst shows nothing yet)
// with an empty diagrams.net diagram in it. See ../diagrams.ts.
import { fromDataUri, writeDiagramXml } from './png';

/** A diagram with one empty page, as diagrams.net writes it. */
export const EMPTY_DIAGRAM_XML =
  '<mxfile><diagram id="page-1" name="Page-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>';

/** A 1×1 transparent PNG. */
const BLANK_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=';

/** The bytes of a new, empty `.drawio.png`. */
export function emptyDiagram(): Uint8Array {
  return writeDiagramXml(fromDataUri(BLANK_PNG)!, EMPTY_DIAGRAM_XML);
}
