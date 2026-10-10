// Grammar: what the projection knows about Typst constructs: the registered node and mark specs (their types are in
// projection.ts), and the tables derived from them (which syntax and calls project to what, how edited nodes print).
// See projection.ts.
import type { NodeType, Schema } from '@tiptap/pm/model';
import type {
  BlockCallProjector, BlockSyntaxProjector, InlineCallProjector, InlineProjector, MarkGrammar, NodeGrammar, ProjectionSpec, RunProjector,
} from './projection';

/** The specs of a schema, merged by name, and the lookups the framework derives from them. */
export class Grammar {
  private readonly nodes = new Map<string, NodeGrammar>();
  private readonly marks = new Map<string, MarkGrammar>();
  private readonly blockSyntaxes = new Map<string, BlockSyntaxProjector[]>();
  private readonly runSyntaxes = new Map<string, RunProjector[]>();
  private readonly calls = new Map<string, BlockCallProjector[]>();
  private readonly inlineSyntaxes = new Map<string, InlineProjector>();
  private readonly inlineCallList: InlineCallProjector[] = [];
  private readonly all: readonly ProjectionSpec[];
  /** Attributes a re-projection may change in place; ignored when documents are compared. */
  readonly anchors = new Set(['src', 'sep', 'lead', 'trail', 'label']);

  constructor(nodes: readonly NodeGrammar[], marks: readonly MarkGrammar[]) {
    for (const spec of nodes) {
      this.nodes.set(spec.name, { ...this.nodes.get(spec.name), ...spec });
      for (const anchor of spec.anchors ?? []) this.anchors.add(anchor);
    }
    for (const spec of marks) this.marks.set(spec.name, { ...this.marks.get(spec.name), ...spec });
    this.all = [...nodes, ...marks];
    for (const spec of this.all) this.addProjectors(spec);
  }

  /** The grammar `attach` gave `schema`. */
  static of(schema: Schema): Grammar {
    const grammar = schema.cached.typstGrammar as Grammar | undefined;
    if (!grammar) throw new Error('No Typst grammar attached to this schema (see attachGrammar)');
    return grammar;
  }

  /** Makes `grammar` the one `project` and `print` use for documents of `schema`. */
  static attach(schema: Schema, grammar: Grammar): void {
    schema.cached.typstGrammar = grammar;
  }

  node(type: NodeType): NodeGrammar | undefined {
    return this.nodes.get(type.name);
  }

  mark(name: string): MarkGrammar | undefined {
    return this.marks.get(name);
  }

  /** Projectors of block syntax `name`, in registration order (none: not a block of its own). */
  blockSyntax(name: string): readonly BlockSyntaxProjector[] {
    return this.blockSyntaxes.get(name) ?? [];
  }

  runSyntax(name: string): readonly RunProjector[] {
    return this.runSyntaxes.get(name) ?? [];
  }

  /** The projectors of calls to `name`: those naming it, else those taking any call. */
  blockCalls(name: string): readonly BlockCallProjector[] {
    return this.calls.get(name) ?? this.calls.get('*') ?? [];
  }

  inlineSyntax(name: string): InlineProjector | undefined {
    return this.inlineSyntaxes.get(name);
  }

  inlineCalls(): readonly InlineCallProjector[] {
    return this.inlineCallList;
  }

  /** The specs whose projection can change after the fact (see `ProjectionSpec.onDidChange`). */
  changing(): ProjectionSpec[] {
    return this.all.filter((spec) => spec.onDidChange);
  }

  private addProjectors(spec: ProjectionSpec): void {
    const add = <T>(map: Map<string, T[]>, key: string, value: T) => map.set(key, [...(map.get(key) ?? []), value]);
    for (const [name, projector] of Object.entries(spec.blockSyntax ?? {})) add(this.blockSyntaxes, name, projector);
    for (const [name, projector] of Object.entries(spec.runSyntax ?? {})) add(this.runSyntaxes, name, projector);
    for (const [name, projector] of Object.entries(spec.blockCalls ?? {})) add(this.calls, name, projector);
    for (const [name, projector] of Object.entries(spec.inlineSyntax ?? {})) this.inlineSyntaxes.set(name, projector);
    this.inlineCallList.push(...(spec.inlineCalls ?? []));
  }
}
