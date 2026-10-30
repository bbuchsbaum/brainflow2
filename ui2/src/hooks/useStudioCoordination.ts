import { useEffect } from 'react';
import { useAppModeStore } from '@/stores/appModeStore';
import { getStudioCoordinationService } from '@/services/studio/StudioCoordinationService';
import { getStudioDisplayService } from '@/services/studio/StudioDisplayService';

export function useStudioCoordination() {
  const appMode = useAppModeStore((state) => state.mode);

  useEffect(() => {
    const service = getStudioCoordinationService();
    if (appMode === 'studio') {
      service.start();
      return () => {
        service.stop();
        // Studio member layers stay in the Studio (QA §11).
        void getStudioDisplayService().releaseStudioLayers();
      };
    }

    service.stop();
    return undefined;
  }, [appMode]);
}
