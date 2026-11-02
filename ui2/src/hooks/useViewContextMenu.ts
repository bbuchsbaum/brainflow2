/**
 * useViewContextMenu
 *
 * Provides a standard right-click context menu for renderable views.
 * Includes the pointer-readout toggle and "Export View as Image..." and ensures the view is
 * marked active before exporting.
 */

import { useCallback } from 'react';
import { useActiveRenderable } from '@/hooks/useActiveRenderable';
import { useContextMenuStore } from '@/stores/contextMenuStore';
import { useExportDialogStore } from '@/stores/exportDialogStore';
import { getEventBus } from '@/events/EventBus';
import { useHoverSettingsStore } from '@/stores/hoverSettingsStore';
import { useLayerStore } from '@/stores/layerStore';
import { useDisplayOptionsStore } from '@/stores/displayOptionsStore';
import { currentOverlayColorbarLayerId } from '@/components/views/viewportFrame/useOverlayColorbar';
import { useColorbarGroup } from '@/components/views/viewportFrame/viewportFrameStore';
import { useViewDisplaySettingsStore } from '@/stores/viewDisplaySettingsStore';
import { fitView } from '@/services/ViewZoomService';
import type { ViewType } from '@/types/coordinates';

export function useViewContextMenu(contextId: string) {
  const markActive = useActiveRenderable(contextId);
  // A view whose colorbar group names its layer (Studio Compare pane A: the
  // member) toggles that layer's colorbar, the one it shows.
  const { describeLayerId } = useColorbarGroup();

  return useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      markActive();

      const clickX = event.clientX;
      const clickY = event.clientY;

      const pointerShown = useHoverSettingsStore.getState().showInStatusBar;

      // Compute current orientation markers state for menu label
      const visibleLayers = useLayerStore.getState().layers.filter(l => l.visible);
      const primaryLayerId = visibleLayers[0]?.id;
      const markersOn = primaryLayerId
        ? useDisplayOptionsStore.getState().getOptions(primaryLayerId).showOrientationMarkers
        : true;

      // Colorbar toggle for the colorbar the view shows: the same layer as
      // useOverlayColorbar (the group's layer, else the active layer, topmost
      // overlay, run-group base).
      const colorbarLayerId = describeLayerId ?? currentOverlayColorbarLayerId();
      const colorbarOn = colorbarLayerId
        ? useDisplayOptionsStore.getState().getOptions(colorbarLayerId).showColorbar !== false
        : false;
      const colorbarItems = colorbarLayerId
        ? [
            {
              id: 'toggle-colorbar',
              label: colorbarOn ? 'Hide colorbar' : 'Show colorbar',
              onClick: () =>
                useDisplayOptionsStore
                  .getState()
                  .setOptions(colorbarLayerId, { showColorbar: !colorbarOn }),
            },
          ]
        : [];

      useContextMenuStore.getState().open(clickX, clickY, [
        {
          // "Hover Info…" (QA design decisions 2026-10-30, section 4): shows
          // or hides the status bar's Pointer group. A toggle, so no ellipsis.
          id: 'hover-settings',
          label: pointerShown ? 'Hide pointer readout' : 'Show pointer readout',
          onClick: () => useHoverSettingsStore.getState().setShowInStatusBar(!pointerShown),
        },
        {
          id: 'toggle-orientation-labels',
          label: markersOn ? 'Hide orientation labels' : 'Show orientation labels',
          onClick: () => {
            const layers = useLayerStore.getState().layers.filter(l => l.visible);
            const store = useDisplayOptionsStore.getState();
            for (const layer of layers) {
              store.setOptions(layer.id, { showOrientationMarkers: !markersOn });
            }
          }
        },
        ...colorbarItems,
        ...sliceViewItems(contextId),
        {
          id: 'separator-1',
          label: '',
          separator: true
        },
        {
          id: 'image-header',
          // Sentence case, like the toggles above (QA 2026-10-30 F47).
          label: 'Image header…',
          onClick: () => getEventBus().emit('ui.imageHeader.open', {})
        },
        {
          id: 'export-image',
          label: 'Export view as image…',
          onClick: () => useExportDialogStore.getState().open()
        }
      ]);
    },
    [contextId, markActive, describeLayerId]
  );
}

const SLICE_VIEWS = new Set(['axial', 'sagittal', 'coronal']);

/**
 * Slice views: Fit (drop zoom and pan) and the display convention (QA
 * features 2026-10-31 §1–2).
 */
function sliceViewItems(contextId: string) {
  if (!SLICE_VIEWS.has(contextId)) return [];
  const radiological = useViewDisplaySettingsStore.getState().radiological;
  return [
    {
      id: 'fit-view',
      label: 'Fit to view',
      onClick: () => void fitView(contextId as ViewType),
    },
    {
      id: 'toggle-radiological',
      label: radiological ? 'Use neurological convention' : 'Use radiological convention',
      onClick: () => useViewDisplaySettingsStore.getState().toggleRadiological(),
    },
  ];
}

