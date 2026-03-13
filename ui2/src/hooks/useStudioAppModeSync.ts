import { useEffect } from 'react';
import type { WorkspaceType } from '@/types/workspace';
import { useAppModeStore } from '@/stores/appModeStore';

export function useStudioAppModeSync(activeWorkspaceType: WorkspaceType | null) {
  const enterStudioMode = useAppModeStore((state) => state.enterStudioMode);
  const enterImagingMode = useAppModeStore((state) => state.enterImagingMode);

  useEffect(() => {
    if (activeWorkspaceType === 'set-studio') {
      enterStudioMode();
      return;
    }

    enterImagingMode();
  }, [activeWorkspaceType, enterImagingMode, enterStudioMode]);
}
