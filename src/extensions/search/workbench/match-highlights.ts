// Every match of the search highlighted in the Visual and Source editors. See search in ../search.ts.
import { StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, ViewPlugin } from '@codemirror/view';
import { EventEmitter } from '../../../core/event-emitter/event-emitter';
import type { ProjectPath } from '../../../core/paths/paths';
import type { Project } from '../../../core/project/project';
import type { TypstDocument } from '../../../core/typst-document/typst-document';
import type { CodeMirrorContext } from '../../../hosts/source-editor/source-editor';
import type { SourceHighlight, SourceHighlightProvider } from '../../../hosts/visual-editor/visual-editor';
import type { SearchResults } from '../model/search-results';
import type { TextMatch } from '../model/text-query';

/**
 * The matches the panel lists, highlighted in every editor of their file, the current one (the match row the panel's
 * tree is on) emphasised: as Visual highlights (`visualHighlights`) and as a CodeMirror extension for the Source
 * editors (`sourceExtension`). The panel says what to show (`show`), after each redraw; an editor hears only of its
 * own file's change, a moment later (never in the middle of an edit being applied), and its highlights follow edits
 * until then.
 */
export class MatchHighlights {
  readonly #changed = new EventEmitter<TypstDocument>();
  readonly #project: Pick<Project, 'document' | 'pathOf'>;
  /** The matches shown, by file (the results' own arrays: a file searched again has a new one). */
  #shown = new Map<ProjectPath, readonly TextMatch[]>();
  #current: CurrentMatch | null = null;
  /** The files whose editors are told of their change in a moment. */
  readonly #pending = new Set<ProjectPath>();

  constructor(project: Pick<Project, 'document' | 'pathOf'>) {
    this.#project = project;
  }

  /** What the Visual editors draw as layer `search`. */
  readonly visualHighlights: SourceHighlightProvider = {
    provideHighlights: (document) => this.#highlightsOf(document),
    onDidChangeHighlights: this.#changed.event,
  };

  /** What each Source editor draws: the highlights of its document. */
  readonly sourceExtension = (editor: CodeMirrorContext): Extension => {
    if (editor.editor !== 'source') return [];
    const { document } = editor;
    const field = StateField.define<DecorationSet>({
      create: (state) => marks(this.#highlightsOf(document), state.doc.length),
      update: (set, tr) => tr.effects.find((effect) => effect.is(setMarks))?.value ?? set.map(tr.changes),
      provide: (self) => EditorView.decorations.from(self),
    });
    const follow = ViewPlugin.define((view) => {
      const subscription = this.#changed.event((changed) => {
        if (changed === document) view.dispatch({ effects: setMarks.of(marks(this.#highlightsOf(document), view.state.doc.length)) });
      });
      return { destroy: () => subscription.dispose() };
    });
    return [field, follow];
  };

  /** Highlights the matches of `results` (none: nothing), `current` emphasised. */
  show(results: SearchResults | null, current: CurrentMatch | null): void {
    const shown = new Map((results?.files() ?? []).map(({ path, matches }) => [path, matches]));
    const changed = [...new Set([...this.#shown.keys(), ...shown.keys()])].filter((path) => this.#shown.get(path) !== shown.get(path));
    if (this.#current?.match !== current?.match) changed.push(...[this.#current, current].flatMap((match) => (match ? [match.path] : [])));
    this.#shown = shown;
    this.#current = current;
    for (const path of changed) this.#changeLater(path);
  }

  dispose(): void {
    this.#pending.clear();
    this.#changed.dispose();
  }

  #highlightsOf(document: TypstDocument): SourceHighlight[] {
    const path = this.#project.pathOf(document);
    const current = this.#current?.path === path ? this.#current?.match : undefined;
    return (path ? (this.#shown.get(path) ?? []) : []).map((match) => ({
      from: match.from,
      to: match.to,
      className: match === current ? `${CLASS} ${CLASS}--current` : CLASS,
    }));
  }

  /** Tells the editors of `path` in a moment: whoever asked may be inside an edit's notification. */
  #changeLater(path: ProjectPath): void {
    if (this.#pending.size === 0) {
      queueMicrotask(() => {
        const paths = [...this.#pending];
        this.#pending.clear();
        for (const changed of paths) {
          const document = this.#project.document(changed);
          if (document) this.#changed.fire(document);
        }
      });
    }
    this.#pending.add(path);
  }
}

/** The match the panel's tree is on, in file `path`. */
export interface CurrentMatch {
  readonly path: ProjectPath;
  readonly match: TextMatch;
}

const CLASS = 'zwf-search__highlight';

/** Replaces a Source editor's match marks. */
const setMarks = StateEffect.define<DecorationSet>();

/** The marks of `highlights` in a text of `length` (beyond it: dropped). */
function marks(highlights: readonly SourceHighlight[], length: number): DecorationSet {
  return Decoration.set(highlights.filter(({ to }) => to <= length).map(({ from, to, className }) => Decoration.mark({ class: className }).range(from, to)));
}
