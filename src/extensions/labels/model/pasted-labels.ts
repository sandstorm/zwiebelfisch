// New names for pasted labels the project has already. See labels in ../labels.ts.
import type { ProjectPath } from '../../../core/paths/paths';
import type { SourceRange } from '../../../core/typst-document/typst-document';
import { syntaxTree } from '../../../core/typst-syntax/typst-syntax';
import type { LabelInfo } from './label-index';
import { scanTypst } from './scan';

/**
 * Pasted Typst `pasted`, going into the file `target` (its text before the paste) in place of `ranges`, with every
 * label it defines that the project has already renamed: `<fig:setup>` becomes `<fig:setup-1>`, the first of `-1`,
 * `-2`, … that is free (no label of the project, of the paste, nor another new name). What in the pasted text points
 * to such a label points to the new name (`@fig:setup`, `#ref(<fig:setup>)`, `#link(<fig:setup>)`); references to
 * labels the paste does not define stay. The project's labels are `labels` of the other files and those of the
 * target's text outside `ranges`: a label just cut, or one the paste replaces, is free.
 */
export function renamePastedLabels(pasted: string, target: { path: ProjectPath; text: string }, ranges: readonly SourceRange[], labels: readonly LabelInfo[]): string {
  const remaining = [...ranges].sort((a, b) => b.from - a.from).reduce((text, { from, to }) => text.slice(0, from) + text.slice(to), target.text);
  const taken = new Set([...labels.filter(({ path }) => path !== target.path), ...scanTypst(remaining).labels].map(({ name }) => name));
  const defined = new Set(scanTypst(pasted).labels.map(({ name }) => name));
  const used = new Set([...taken, ...defined]);
  const renames = new Map<string, string>();
  for (const name of defined) {
    if (!taken.has(name)) continue;
    let count = 1;
    while (used.has(`${name}-${count}`)) count++;
    used.add(`${name}-${count}`);
    renames.set(name, `${name}-${count}`);
  }
  return renames.size === 0 ? pasted : renamed(pasted, renames);
}

/** Typst `text` with each label (`<name>`) and reference (`@name`) whose name `renames` has renamed. */
function renamed(text: string, renames: ReadonlyMap<string, string>): string {
  const names: { from: number; to: number; insert: string }[] = [];
  const cursor = syntaxTree(text).cursor();
  do {
    // the name: inside `<..>`, after `@`
    const at = cursor.name === 'Label' ? { from: cursor.from + 1, to: cursor.to - 1 } : cursor.name === 'RefMarker' ? { from: cursor.from + 1, to: cursor.to } : null;
    const insert = at && renames.get(text.slice(at.from, at.to));
    if (at && insert) names.push({ ...at, insert });
  } while (cursor.next());
  return names.reduceRight((current, { from, to, insert }) => current.slice(0, from) + insert + current.slice(to), text);
}
