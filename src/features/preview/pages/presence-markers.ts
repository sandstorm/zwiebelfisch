import { flagTextColor, initials, type PresenceUser } from '../../../core/typst-document/presence';
import type { Position } from '../../../core/typst-engine/typst-engine';

/** One user's marker on a page: where (percent of the page, at the text baseline), what it says, in which colors. */
export interface PresenceMarker {
  id: string;
  page: number;
  left: number;
  top: number;
  /** How many markers at the same spot come before this one (they are drawn side by side). */
  stack: number;
  /** The user's initials. */
  label: string;
  /** The user's full name (tooltip). */
  title: string;
  color: string;
  textColor: string;
}

/** Points closer than this (in pt, both directions) count as the same spot. */
const SAME_SPOT_PT = 6;

/**
 * Where each user's marker goes: at the first place the engine draws their
 * caret (`positions` from jumpFromCursor). Users whose caret draws nowhere,
 * or on a page not shown, get none. Markers at the same spot are numbered
 * (`stack`), so all initials stay readable.
 */
export function presenceMarkers(
  found: readonly { id: string; user: PresenceUser; positions: readonly Position[] }[],
  pageSize: (page: number) => { width: number; height: number } | undefined,
): PresenceMarker[] {
  const placed: (PresenceMarker & { x: number; y: number })[] = [];
  for (const { id, user, positions } of found) {
    const position = positions[0];
    const size = position && pageSize(position.page);
    if (!size) continue;
    const near = (other: { page: number; x: number; y: number }) =>
      other.page === position.page && Math.abs(other.x - position.x) < SAME_SPOT_PT && Math.abs(other.y - position.y) < SAME_SPOT_PT;
    placed.push({
      id,
      page: position.page,
      x: position.x,
      y: position.y,
      left: (position.x / size.width) * 100,
      top: (position.y / size.height) * 100,
      stack: placed.filter(near).length,
      label: initials(user.name),
      title: user.name,
      color: user.color,
      textColor: flagTextColor(user.color),
    });
  }
  return placed.map(({ x: _x, y: _y, ...marker }) => marker);
}
