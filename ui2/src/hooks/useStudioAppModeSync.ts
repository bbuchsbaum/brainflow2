import { useEffect } from 'react';
import type { WorkspaceType } from '@/types/workspace';
import { useAppModeStore } from '@/stores/appModeStore';
import { useCenterTabStore } from '@/stores/centerTabStore';

/**
 * Studio mode while the Set studio tab is in front. A surface tab (or its
 * placeholder) in front is imaging even though the store's active workspace
 * is still the tab behind it (QA 2026-10-31: the status bar read
 * "Coordinate system Studio · Set studio" over a surface).
 */
export function useStudioAppModeSync(activeWorkspaceType: WorkspaceType | null) {
  const enterStudioMode = useAppModeStore((state) => state.enterStudioMode);
  const enterImagingMode = useAppModeStore((state) => state.enterImagingMode);
  const workspaceTabInFront = useCenterTabStore(
    (state) => state.frontComponentType === null || state.frontComponentType === 'Workspace',
  );

  useEffect(() => {
    if (activeWorkspaceType === 'set-studio' && workspaceTabInFront) {
      enterStudioMode();
      return;
    }

    enterImagingMode();
  }, [activeWorkspaceType, workspaceTabInFront, enterImagingMode, enterStudioMode]);
}
