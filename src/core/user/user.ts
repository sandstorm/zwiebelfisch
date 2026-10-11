/**
 * Who works in the widget, as the host page names them (`createTypstEditor({ user })`) and as collaborators see them.
 *
 * In core because both the workbench host and extension models (the collaboration's remote cursors) speak of it, and
 * models may not import hosts. See docs/40_architecture/02_core.typ.
 */
export interface User {
  /** The name others see (collaborating), that signs comments and commits. */
  readonly name: string;
  /** The CSS color others see the user's cursor in (default: one made from the name). */
  readonly color?: string;
}
