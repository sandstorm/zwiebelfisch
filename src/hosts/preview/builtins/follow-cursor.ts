// followCursor: the preview toolbar's "Follow cursor" on/off switch. See builtins.ts.
import type { PreviewToolbarItem } from '../contribution';

export interface FollowCursorOptions {
  /** Whether the preview starts following the cursor. */
  on: boolean;
  /** Called when the user switches it on or off (e.g. to remember it). */
  onChange?(on: boolean): void;
}

/**
 * The "Follow cursor" switch (role=switch): whether the preview scrolls to the text being edited or
 * selected (`Preview.reveal`). Switching it on goes to the newest place.
 */
export function followCursor({ on, onChange }: FollowCursorOptions): PreviewToolbarItem {
  return (preview) => {
    const doc = preview.ownerDocument;
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'typst-preview__follow';
    button.setAttribute('role', 'switch');
    button.title = 'Scroll the preview to the text you edit or select';
    const track = doc.createElement('span');
    track.className = 'typst-preview__switch';
    track.setAttribute('aria-hidden', 'true');
    button.append(track, 'Follow cursor');
    const show = (following: boolean) => {
      preview.setFollowing(following);
      button.setAttribute('aria-checked', String(following));
    };
    button.addEventListener('click', () => {
      show(!preview.isFollowing());
      onChange?.(preview.isFollowing());
    });
    show(on);
    return { elements: [button] };
  };
}
