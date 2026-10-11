// A Mermaid diagram in a document as a figure: the starter flowchart, the figure and the import of `mermaid` it
// needs. See mermaid in ../mermaid.ts.
import { ProjectPath } from '../../../core/paths/paths';
import type { SourceOffset, TextChange } from '../../../core/typst-document/typst-document';
import { calculateImportChange, quote } from '../../../core/typst-syntax/typst-syntax';

/** The figure of a Mermaid file in a document, and the change that imports `mermaid` (null: imported already). */
export interface MermaidFigure {
  /** `#figure(mermaid(read("diagram.mmd"), width: 100%), caption: [ ])`. */
  readonly source: string;
  readonly importChange: TextChange | null;
}

/** The package that draws Mermaid diagrams while Typst compiles (the version the docs and the demo use). */
export const MERMAN = '@preview/merman:0.4.0';

/** What "Insert Mermaid diagram" writes into the new `.mmd` file. */
export const STARTER_FLOWCHART = 'flowchart LR\n  Start[Start] --> Step[Do something] --> Done[Done]\n';

/** The extension of Mermaid files. */
export const MERMAID_EXTENSION = '.mmd';

/**
 * The figure drawing the Mermaid file `diagram` in Typst `text` (of the document `file`), used at `use`, and the
 * import of `mermaid` from merman it needs: added to an import of merman (any version) before `use`, else `MERMAN`'s
 * at the top.
 */
export function calculateMermaidFigure(text: string, file: ProjectPath, diagram: ProjectPath, use: SourceOffset): MermaidFigure {
  const version = MERMAN.slice(0, MERMAN.lastIndexOf(':') + 1);
  const importChange = calculateImportChange(text, {
    name: 'mermaid',
    matches: (module) => module.startsWith(version),
    // a blank line after it, unless more imports follow: an import right above a block would make the two one (raw) block
    create: () => `#import ${quote(MERMAN)}: mermaid\n${/^\s*(\n|#import\b)/.test(text) ? '' : '\n'}`,
    use,
  });
  return { source: `#figure(mermaid(read(${quote(ProjectPath.referenceTo(file, diagram))}), width: 100%), caption: [ ])`, importChange };
}

/** Whether `path` is a Mermaid file (by name, in any case). */
export function isMermaid(path: ProjectPath): boolean {
  return path.toLowerCase().endsWith(MERMAID_EXTENSION);
}
