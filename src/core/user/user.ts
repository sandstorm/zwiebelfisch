/**
 * Who works in the widget, as the host page names them (`createEditor({ user })`) and as collaborators see them.
 * Used by:
 * - the window
 * - the collaboration extension (presence, remote cursors)
 */
export interface User {
  /** The name others see (collaborating), that signs comments and commits. */
  readonly name: string;
  /** The CSS color others see the user's cursor in (default: one made from the name). */
  readonly color?: string;
}
