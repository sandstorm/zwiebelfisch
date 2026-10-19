// Help snippets dropped on the Visual editor. See help in ../help.ts.
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { insertTypst } from '../../../hosts/visual-editor/visual-editor';

/**
 * Takes a help row dropped on a Visual editor: its Typst (drag type `TYPST_SNIPPET_TYPE`) is read as Typst and inserted
 * where it was dropped (inline content into the text, blocks after the block there). Other drops it leaves alone.
 */
export function snippetDrops(): Extension {
  return Extension.create({
    name: 'typstHelpSnippetDrops',
    addProseMirrorPlugins() {
      const editor = this.editor;
      return [
        new Plugin({
          key: new PluginKey('typstHelpSnippetDrops'),
          props: {
            handleDOMEvents: {
              drop: (view, event) => {
                const source = event.dataTransfer?.getData(TYPST_SNIPPET_TYPE);
                if (!source) return false;
                event.preventDefault();
                event.stopPropagation();
                insertTypst(editor, source, view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos);
                return true;
              },
            },
          },
        }),
      ];
    },
  });
}

/** The drag type of a help row whose snippet is Typst; the data is the text it inserts. */
export const TYPST_SNIPPET_TYPE = 'application/x-typst-snippet';
