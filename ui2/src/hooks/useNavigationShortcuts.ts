/**
 * useNavigationShortcuts Hook
 * Registers keyboard shortcuts for coordinate navigation:
 *   G - Open GoToCoordinateDialog
 *   O - Navigate crosshair to world origin (0,0,0)
 *   C - Navigate crosshair to volume center
 */

import { useEffect, useCallback } from 'react';
import { getKeyboardShortcutService } from '@/services/KeyboardShortcutService';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useLayerStore } from '@/stores/layerStore';
import { getApiService } from '@/services/apiService';

const CATEGORY = 'Navigation';

interface UseNavigationShortcutsOptions {
  onOpenGoToDialog: () => void;
}

export function useNavigationShortcuts({ onOpenGoToDialog }: UseNavigationShortcutsOptions): void {
  const setCrosshair = useViewStateStore(state => state.setCrosshair);
  const getLayerState = useLayerStore.getState;

  const goToOrigin = useCallback(async () => {
    await setCrosshair([0, 0, 0], true);
  }, [setCrosshair]);

  const goToCenter = useCallback(async () => {
    const layers = getLayerState().layers;
    const visibleLayer = layers.find(l => l.volumeId);

    if (!visibleLayer?.volumeId) {
      // No volume loaded - go to world origin
      await setCrosshair([0, 0, 0], true);
      return;
    }

    try {
      const bounds = await getApiService().getVolumeBounds(visibleLayer.volumeId);
      const center: [number, number, number] = [
        (bounds.min[0] + bounds.max[0]) / 2,
        (bounds.min[1] + bounds.max[1]) / 2,
        (bounds.min[2] + bounds.max[2]) / 2,
      ];
      await setCrosshair(center, true);
    } catch {
      // Fallback to origin if bounds unavailable
      await setCrosshair([0, 0, 0], true);
    }
  }, [setCrosshair, getLayerState]);

  useEffect(() => {
    const service = getKeyboardShortcutService();

    const unregisterFns = [
      service.register({
        id: 'nav.goToCoordinate',
        key: 'g',
        category: CATEGORY,
        description: 'Go to coordinate',
        handler: onOpenGoToDialog,
      }),
      service.register({
        id: 'nav.goToOrigin',
        key: 'o',
        category: CATEGORY,
        description: 'Go to image origin (0, 0, 0)',
        handler: goToOrigin,
      }),
      service.register({
        id: 'nav.goToCenter',
        key: 'c',
        category: CATEGORY,
        description: 'Go to image center',
        handler: goToCenter,
      }),
    ];

    return () => {
      unregisterFns.forEach(fn => fn());
    };
  }, [onOpenGoToDialog, goToOrigin, goToCenter]);
}
