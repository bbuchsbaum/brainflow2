/**
 * useLayoutSync - Synchronizes layout dimensions with ViewState
 * 
 * This hook bridges the gap between LayoutStateStore (UI-only) and ViewStateStore (backend-synced).
 * It ensures that when dragging ends or dimensions stabilize, the ViewState is updated for rendering.
 */

import { useEffect } from 'react';

export function useLayoutSync() {
  useEffect(() => {
    // Legacy hook retained for compatibility. View sizing is now coordinated by
    // the active layout/render services rather than this deprecated sync path.
    return undefined;
  }, []);
}
