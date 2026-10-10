// The document-links extension: the file paths in a Typst file (`#include "ch1.typ"`, `image("logo.png")`) as
// links in the Source view, which open the file or offer to create it. Entry of features/document-links/.
// See ARCHITECTURE.md, "File links".
import { DocumentLinkProvider } from '../../core/document-links/document-links';
import { ProjectPath } from '../../core/paths/paths';
import type { TypstDocument } from '../../core/typst-document/typst-document';
import { fileLinks } from '../../hosts/source-view/source-view';
import { boxLinks } from '../../hosts/visual-view/visual-view';
import type { TypstExtension } from '../../hosts/workbench/workbench';

declare module '../../hosts/workbench/workbench' {
  interface ServiceRegistry {
    /** Where the file paths in a document lead (the document-links extension). */
    documentLinks: (document: TypstDocument) => DocumentLinkProvider;
  }
}

/**
 * Links the file paths of every Typst file in the Source view and in the Visual view's raw boxes: they resolve from
 * the file's current path, open the file in the workbench, and create a missing one through `Workbench.applyChange`.
 * Provides the `documentLinks` service (an image box's path is a link with it, too).
 */
export function documentLinks(): TypstExtension {
  return {
    id: 'document-links',
    activate(context) {
      const { project, workbench, sourceView, services, subscriptions } = context;
      const provider = (document: TypstDocument) =>
        new DocumentLinkProvider({
          resolve: (reference) => {
            const file = project.pathOf(document);
            return file ? ProjectPath.resolve(file, reference) : null;
          },
          exists: (path) => project.has(path),
          open: (path) => workbench.open(path),
          create: async (path) => {
            const problem = await workbench.applyChange({ kind: 'create', path, content: '' });
            if (problem === null) workbench.open(path);
            return problem;
          },
        });
      subscriptions.push(
        services.provide('documentLinks', provider),
        sourceView.registerExtension(fileLinks),
        sourceView.registerLinkProvider(provider),
      );
      boxLinks({ documentLinks: provider }).activate(context);
    },
  };
}
