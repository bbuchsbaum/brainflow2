import { useEffect } from 'react';
import { useAppModeStore } from '@/stores/appModeStore';
import { getStudioCoordinationService } from '@/services/studio/StudioCoordinationService';
import { getStudioDisplayService } from '@/services/studio/StudioDisplayService';
import { getSetIngestionService } from '@/services/studio/SetIngestionService';

export function useStudioCoordination() {
  const appMode = useAppModeStore((state) => state.mode);

  useEffect(() => {
    const service = getStudioCoordinationService();
    if (appMode === 'studio') {
      // A set whose image headers nobody has read is checked in the
      // background, so Population and Compare become ready by themselves.
      service.start({
        autoCheckGrids: () => getSetIngestionService().autoCheckActiveSetGrids(),
      });
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
