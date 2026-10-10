// The preview-controls extension: zoom, "Follow cursor" and the page number in the preview's toolbar.
// Entry of features/preview-controls/. See ARCHITECTURE.md, "Preview".
import { followCursor, pageNumber, zoomControls } from '../../hosts/preview/preview';
import type { TypstExtension } from '../../hosts/workbench/workbench';

export interface PreviewControlsOptions {
  /** Whether the preview starts following the cursor; default: what this viewer chose last (localStorage), else on. */
  followCursor?: boolean;
}

/** Zoom buttons, the "Follow cursor" switch (its choice remembered for this viewer) and "page n / total". */
export function previewControls(options: PreviewControlsOptions = {}): TypstExtension {
  return {
    id: 'preview-controls',
    activate({ preview, subscriptions }) {
      const follow = followCursor({ on: options.followCursor ?? rememberedFollow() ?? true, onChange: rememberFollow });
      for (const item of [zoomControls, follow, pageNumber]) subscriptions.push(preview.registerToolbarItem(item));
    },
  };
}

const FOLLOW_KEY = 'typst-editor:follow-cursor';

/** The viewer's last "Follow cursor" choice, if storage has one (storage may be unavailable). */
function rememberedFollow(): boolean | null {
  try {
    const stored = localStorage.getItem(FOLLOW_KEY);
    return stored === null ? null : stored === 'true';
  } catch {
    return null;
  }
}

function rememberFollow(on: boolean): void {
  try {
    localStorage.setItem(FOLLOW_KEY, String(on));
  } catch {
    // private window, blocked storage: the choice lasts for this page only
  }
}
