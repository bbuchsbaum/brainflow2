/**
 * useViewContextMenu
 *
 * Provides a standard right-click context menu for renderable views.
 * Includes "Hover Info..." and "Export View as Image..." and ensures the view is
 * marked active before exporting.
 */

import { useCallback } from 'react';
import { useActiveRenderable } from '@/hooks/useActiveRenderable';
import { useContextMenuStore } from '@/stores/contextMenuStore';
import { useExportDialogStore } from '@/stores/exportDialogStore';
import { useHoverSettingsPopoverStore } from '@/stores/hoverSettingsPopoverStore';
import { useLayerStore } from '@/stores/layerStore';
import { useDisplayOptionsStore } from '@/stores/displayOptionsStore';

export function useViewContextMenu(contextId: string) {
  const markActive = useActiveRenderable(contextId);

  return useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      markActive();

      const clickX = event.clientX;
      const clickY = event.clientY;

      // Compute current orientation markers state for menu label
      const visibleLayers = useLayerStore.getState().layers.filter(l => l.visible);
      const primaryLayerId = visibleLayers[0]?.id;
      const markersOn = primaryLayerId
        ? useDisplayOptionsStore.getState().getOptions(primaryLayerId).showOrientationMarkers
        : true;

      useContextMenuStore.getState().open(clickX, clickY, [
        {
          id: 'hover-settings',
          label: 'Hover Info…',
          onClick: () => {
            // Open popover slightly offset from where the context menu was
            useHoverSettingsPopoverStore.getState().open(clickX, clickY);
          }
        },
        {
          id: 'toggle-orientation-labels',
          label: markersOn ? 'Hide Orientation Labels' : 'Show Orientation Labels',
          onClick: () => {
            const layers = useLayerStore.getState().layers.filter(l => l.visible);
            const store = useDisplayOptionsStore.getState();
            for (const layer of layers) {
              store.setOptions(layer.id, { showOrientationMarkers: !markersOn });
            }
          }
        },
        {
          id: 'separator-1',
          label: '',
          separator: true
        },
        {
          id: 'export-image',
          label: 'Export View as Image…',
          onClick: () => useExportDialogStore.getState().open()
        }
      ]);
    },
    [markActive]
  );
}

