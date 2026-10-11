// User. Entry of core/user/. See docs/30_architecture/01_overview.typ.

/**
 * Who works in the widget.
 *
 * Who works in the widget, as the host names them (`createTypstEditor({ user })`) and as collaborators see them. In
 * core because both the workbench host and extension models (collaboration's remote cursors) speak of it, and models
 * may not import hosts.
 */
export interface User {
  /** The name others see (collaborating), that signs comments and commits. */
  readonly name: string;
  /** The CSS color others see the user's cursor in (default: one made from the name). */
  readonly color?: string;
}
