import { useEffect } from 'react';
import { useAppModeStore } from '@/stores/appModeStore';
import { getStudioCoordinationService } from '@/services/studio/StudioCoordinationService';

export function useStudioCoordination() {
  const appMode = useAppModeStore((state) => state.mode);

  useEffect(() => {
    const service = getStudioCoordinationService();
    if (appMode === 'studio') {
      service.start();
      return () => {
        service.stop();
      };
    }

    service.stop();
    return undefined;
  }, [appMode]);
}
