// Grammar: what the framework knows about Typst constructs: the registered node and mark specs (their types are in
// projection.ts), and the tables derived from their parse rules (which syntax and calls become what) and from their
// Typst (how edited nodes are written). See projection.ts.
import type { NodeType, Schema } from '@tiptap/pm/model';
import type { Event } from '../../core/event-emitter/event-emitter';
import type { DocumentNodeSpec, TypstMarkSpec, TypstParseRules } from './projection';

type SyntaxNodeRule = NonNullable<TypstParseRules['syntaxNodes']>[string];
type CallRule = NonNullable<TypstParseRules['calls']>[string];

/** The specs of a schema, merged by name, and the lookups the framework derives from them. */
export class Grammar {
  private readonly nodes = new Map<string, DocumentNodeSpec>();
  private readonly marks = new Map<string, TypstMarkSpec>();
  private readonly syntaxNodes = new Map<string, SyntaxNodeRule[]>();
  private readonly calls = new Map<string, CallRule[]>();
  private readonly onDidChanges: Event<void>[] = [];
  /** Attributes a fresh parse may change in place; ignored when documents are compared. */
  readonly anchors = new Set(['src', 'sep', 'lead', 'trail', 'label']);

  constructor(nodes: readonly DocumentNodeSpec[], marks: readonly TypstMarkSpec[]) {
    for (const spec of nodes) {
      const merged = this.nodes.get(spec.name);
      this.nodes.set(spec.name, { ...merged, ...spec, typst: { ...merged?.typst, ...spec.typst } });
      for (const anchor of spec.typst?.anchors ?? []) this.anchors.add(anchor);
    }
    for (const spec of marks) this.marks.set(spec.name, { ...this.marks.get(spec.name), ...spec });
    for (const typst of [...nodes.map((spec) => spec.typst), ...marks.map((spec) => spec.typst)]) {
      const add = <T>(map: Map<string, T[]>, key: string, value: T) => map.set(key, [...(map.get(key) ?? []), value]);
      for (const [name, rule] of Object.entries(typst?.parseTypst?.syntaxNodes ?? {})) add(this.syntaxNodes, name, rule);
      for (const [name, rule] of Object.entries(typst?.parseTypst?.calls ?? {})) add(this.calls, name, rule);
      if (typst?.onDidChange) this.onDidChanges.push(typst.onDidChange);
    }
  }

  /** The grammar `attach` gave `schema`. */
  static of(schema: Schema): Grammar {
    const grammar = schema.cached.typstGrammar as Grammar | undefined;
    if (!grammar) throw new Error('No Typst grammar attached to this schema (see attachGrammar)');
    return grammar;
  }

  /** Makes `grammar` the one the parser and the serializer use for documents of `schema`. */
  static attach(schema: Schema, grammar: Grammar): void {
    schema.cached.typstGrammar = grammar;
  }

  node(type: NodeType): DocumentNodeSpec | undefined {
    return this.nodes.get(type.name);
  }

  mark(name: string): TypstMarkSpec | undefined {
    return this.marks.get(name);
  }

  /** The rules of syntax node `name`, in the specs' order. */
  syntaxNode(name: string): readonly SyntaxNodeRule[] {
    return this.syntaxNodes.get(name) ?? [];
  }

  /** The rules of calls to `name` that have `role`: those naming it, else those taking any call (`*`). */
  call<K extends keyof CallRule>(name: string, role: K): readonly CallRule[] {
    const named = (this.calls.get(name) ?? []).filter((rule) => rule[role]);
    return named.length > 0 ? named : (this.calls.get('*') ?? []).filter((rule) => rule[role]);
  }

  /** The specs' events firing when what they read changed (see `TypstNodeConversion.onDidChange`). */
  changing(): readonly Event<void>[] {
    return this.onDidChanges;
  }
}
