// What the preview-sync extension adds to the preview's toolbar: the "Follow cursor" on/off switch. See previewSync in ../preview-sync.ts.
import type { PreviewToolbarItem } from '../../../hosts/preview/preview';

/** The "Follow cursor" switch (role=switch): whether the preview scrolls to the text being edited or selected. */
export function followCursor({ on, onChange }: FollowCursorOptions): PreviewToolbarItem {
  return (preview) => {
    const doc = preview.ownerDocument;
    let following = on;
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'zwf-preview-sync__follow';
    button.setAttribute('role', 'switch');
    button.title = 'Scroll the preview to the text you edit or select';
    const track = doc.createElement('span');
    track.className = 'zwf-preview-sync__switch';
    track.setAttribute('aria-hidden', 'true');
    button.append(track, 'Follow cursor');
    const show = () => button.setAttribute('aria-checked', String(following));
    button.addEventListener('click', () => {
      following = !following;
      show();
      onChange(following);
    });
    show();
    return { elements: [button] };
  };
}

export interface FollowCursorOptions {
  /** Whether it starts on. */
  on: boolean;
  /** Called when the user switches it on or off. */
  onChange(on: boolean): void;
}
