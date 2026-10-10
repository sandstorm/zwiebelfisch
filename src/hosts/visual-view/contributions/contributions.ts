// VisualViewContributions: the Visual view's contribution points. Every Typst construct beyond paragraphs and
// raw Typst, and every feature (labels, comments, styles, …), comes into the view through them, so the view's
// mechanism names none of them. Entry of visual-view/contributions/. See ARCHITECTURE.md, "VisualView".
import type { AnyExtension } from '@tiptap/core';
import type { Plugin } from '@tiptap/pm/state';
import { Disposable } from '../../../core/disposable/disposable';
import type { Event } from '../../../core/event-emitter/event-emitter';
import type { Highlight, TypstDocument } from '../../../core/typst-document/typst-document';
import type { MarkGrammar, NodeGrammar } from '../projection/projection';
import type { BoxCodeExtensionProvider, BoxRendererProvider, CodeBoxSpec } from './boxes';
import type { ToolbarGroup, ToolbarItem } from './toolbar-items';
import type { VisualViewContext } from './view-context';

export type { BoxCodeExtensionProvider, BoxPicture, BoxRenderer, BoxRendererProvider, BoxTools, BoxToolsHost, CodeBoxSpec } from './boxes';
export { svg, type Action, type ToolbarContext, type ToolbarControl, type ToolbarGroup, type ToolbarItem } from './toolbar-items';
export type { VisualViewContext } from './view-context';

/**
 * A Typst construct the Visual view models as a node: its Tiptap extension
 * (schema, node view, commands, keymap, input rules), which syntax and calls
 * project to it, how an edited one prints, its label and box flags (see
 * `NodeGrammar`), and for a code box what it shows besides the code.
 */
export interface TypstNodeSpec extends NodeGrammar {
  /** For `box: 'code'`: a heading or tools around the code (an image's resize handles). */
  readonly codeBox?: CodeBoxSpec;
}

/** A Typst construct the Visual view models as a mark (bold, a link, a margin note's range); see `MarkGrammar`. */
export type TypstMarkSpec = MarkGrammar;

/** Tiptap extensions for one view: decorations, plugins (drops, appended transactions), commands not tied to a node. */
export type EditorExtensionProvider = (view: VisualViewContext) => AnyExtension | readonly AnyExtension[];

/** A column beside the text (the notes gutter), made for one view. */
export interface Gutter {
  /** Added to the view's editor state. */
  readonly plugin?: Plugin;
  destroy(): void;
}

/** Makes a view's gutter in `body`, the element holding the text (`.typst-visual__body`). */
export type GutterProvider = (view: VisualViewContext, body: HTMLElement) => Gutter;

/** Styled source ranges of each document (diagnostics), kept up to date in its Visual views. */
export interface HighlightProvider {
  /** The highlights of `document` now (source offsets in its current text). */
  provideHighlights(document: TypstDocument): readonly Highlight[];
  /** Fires with a document whose highlights changed. */
  readonly onDidChangeHighlights: Event<TypstDocument>;
}

/** What a contribution's `activate` gets: a part of the extension context (which offers more). */
export interface ContributionContext {
  readonly visualView: VisualViewContributions;
  /** Disposed when the contribution is deactivated, in reverse order. */
  readonly subscriptions: { dispose(): unknown }[];
}

/**
 * A construct or feature contributing to the Visual view: `activate` registers
 * its parts and pushes each registration's Disposable to `subscriptions`.
 * Shaped like an extension (`TypstExtension`): a construct without
 * configuration is one, in the widget's list of built-in extensions; a
 * feature's extension activates the contributions it configures.
 */
export interface VisualViewContribution {
  readonly id: string;
  activate(context: ContributionContext): void;
}

/** Everything registered, in registration order: what the host applies to each view it creates. */
export interface Contributed {
  readonly nodes: readonly TypstNodeSpec[];
  readonly marks: readonly TypstMarkSpec[];
  readonly editorExtensions: readonly EditorExtensionProvider[];
  readonly toolbarGroups: readonly ToolbarGroup[];
  readonly toolbarItems: readonly ToolbarItem[];
  readonly gutters: readonly GutterProvider[];
  readonly highlights: readonly { readonly layer: string; readonly provider: HighlightProvider }[];
  readonly boxRenderers: readonly BoxRendererProvider[];
  readonly boxCodeExtensions: readonly BoxCodeExtensionProvider[];
}

/**
 * The Visual view's contribution points. Contributions register once, at
 * activation; the host applies what is registered to every view it creates
 * from then on (views are created lazily, per document), so a contribution
 * never tracks views. Everything a contribution needs per view (its document,
 * a popover) it gets through the `…Provider` functions. Disposing a
 * registration takes it out of views created later.
 */
export class VisualViewContributions {
  private readonly lists = {
    nodes: [] as TypstNodeSpec[],
    marks: [] as TypstMarkSpec[],
    editorExtensions: [] as EditorExtensionProvider[],
    toolbarGroups: [] as ToolbarGroup[],
    toolbarItems: [] as ToolbarItem[],
    gutters: [] as GutterProvider[],
    highlights: [] as { layer: string; provider: HighlightProvider }[],
    boxRenderers: [] as BoxRendererProvider[],
    boxCodeExtensions: [] as BoxCodeExtensionProvider[],
  };

  /** A registry with `contributions` activated, for as long as it lives (for a view without the workbench, as in tests). */
  static from(contributions: readonly VisualViewContribution[]): VisualViewContributions {
    const visualView = new VisualViewContributions();
    const subscriptions: { dispose(): unknown }[] = [];
    for (const contribution of contributions) contribution.activate({ visualView, subscriptions });
    return visualView;
  }

  /** A node type and its Typst: schema, projection, printing, box. */
  registerNode(spec: TypstNodeSpec): Disposable {
    return this.add(this.lists.nodes, spec);
  }

  /** A mark type and its Typst. */
  registerMark(spec: TypstMarkSpec): Disposable {
    return this.add(this.lists.marks, spec);
  }

  /** Tiptap extensions made for each view (they may use its document). */
  registerEditorExtension(provider: EditorExtensionProvider): Disposable {
    return this.add(this.lists.editorExtensions, provider);
  }

  /** A place for toolbar items: a group, a menu or a floating bar. */
  registerToolbarGroup(group: ToolbarGroup): Disposable {
    return this.add(this.lists.toolbarGroups, group);
  }

  /** A button or control in a toolbar group (one the host or a contribution registered). */
  registerToolbarItem(item: ToolbarItem): Disposable {
    return this.add(this.lists.toolbarItems, item);
  }

  /** A column beside the text, made for each view. */
  registerGutter(provider: GutterProvider): Disposable {
    return this.add(this.lists.gutters, provider);
  }

  /**
   * Highlights from `provider` in every view, as layer `layer` (one per provider): set when the view is created and
   * again whenever the provider reports a change of its document; they follow edits in between.
   */
  registerHighlights(layer: string, provider: HighlightProvider): Disposable {
    return this.add(this.lists.highlights, { layer, provider });
  }

  /** What raw boxes of each view show instead of their code while not edited. */
  registerBoxRenderer(provider: BoxRendererProvider): Disposable {
    return this.add(this.lists.boxRenderers, provider);
  }

  /** CodeMirror extensions for the code of every raw box of each view. */
  registerBoxCodeExtension(provider: BoxCodeExtensionProvider): Disposable {
    return this.add(this.lists.boxCodeExtensions, provider);
  }

  /** Everything registered now (for the host, when it creates a view). */
  contributed(): Contributed {
    const lists = this.lists;
    return {
      nodes: [...lists.nodes],
      marks: [...lists.marks],
      editorExtensions: [...lists.editorExtensions],
      toolbarGroups: [...lists.toolbarGroups],
      toolbarItems: [...lists.toolbarItems],
      gutters: [...lists.gutters],
      highlights: [...lists.highlights],
      boxRenderers: [...lists.boxRenderers],
      boxCodeExtensions: [...lists.boxCodeExtensions],
    };
  }

  private add<T>(list: T[], value: T): Disposable {
    list.push(value);
    return new Disposable(() => {
      const index = list.indexOf(value);
      if (index >= 0) list.splice(index, 1);
    });
  }
}
