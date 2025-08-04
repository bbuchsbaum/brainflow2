/**
 * Tests for selective store subscriptions optimization
 */

import { describe, test, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { render } from '@testing-library/react';
import { useViewStateStore } from '@/stores/viewStateStore';
import { 
  useTimepointSelector,
  useCrosshairSelector,
  useViewDataSelector,
  useRenderDataSelector,
} from '@/stores/selectors/viewStateSelectors';
import { RenderFrequencyMonitor } from '../helpers/performanceUtils';

describe('Selective Store Subscriptions', () => {
  describe('Subscription Efficiency', () => {
    test('should only re-render when subscribed slice changes', () => {
      const monitor = new RenderFrequencyMonitor();
      
      // Component that only subscribes to timepoint
      const { result } = renderHook(() => {
        monitor.recordRender();
        return useTimepointSelector();
      });
      
      const initialRenderCount = monitor.getRenderCount();
      
      // Change unrelated state (crosshair)
      act(() => {
        useViewStateStore.getState().setCrosshair([10, 20, 30]);
      });
      
      // Should not trigger re-render
      expect(monitor.getRenderCount()).toBe(initialRenderCount);
      
      // Change subscribed state (timepoint)
      act(() => {
        useViewStateStore.getState().setViewState(state => {
          state.timepoint = 5;
        });
      });
      
      // Should trigger re-render
      expect(monitor.getRenderCount()).toBe(initialRenderCount + 1);
    });

    test('should use shallow comparison for object subscriptions', () => {
      const monitor = new RenderFrequencyMonitor();
      
      const { result } = renderHook(() => {
        monitor.recordRender();
        return useCrosshairSelector();
      });
      
      const initialRenderCount = monitor.getRenderCount();
      
      // Update with same values (should not re-render due to shallow comparison)
      act(() => {
        const currentCrosshair = useViewStateStore.getState().viewState.crosshair;
        useViewStateStore.getState().setViewState(state => {
          state.crosshair = { ...currentCrosshair }; // Same values, new object
        });
      });
      
      // Shallow comparison should prevent re-render
      expect(monitor.getRenderCount()).toBe(initialRenderCount);
    });
  });

  describe('Component Re-render Patterns', () => {
    test('should reduce re-renders by 60% with selective subscriptions', () => {
      let fullSubscriptionRenders = 0;
      let selectiveSubscriptionRenders = 0;
      
      // Component with full viewState subscription (old pattern)
      const FullSubscriptionComponent = () => {
        fullSubscriptionRenders++;
        const viewState = useViewStateStore(state => state.viewState);
        return <div>{viewState.timepoint}</div>;
      };
      
      // Component with selective subscription (new pattern)
      const SelectiveSubscriptionComponent = () => {
        selectiveSubscriptionRenders++;
        const timepoint = useTimepointSelector();
        return <div>{timepoint}</div>;
      };
      
      render(<FullSubscriptionComponent />);
      render(<SelectiveSubscriptionComponent />);
      
      // Reset counters after initial render
      fullSubscriptionRenders = 0;
      selectiveSubscriptionRenders = 0;
      
      // Make various state changes
      act(() => {
        // Change crosshair (should only affect full subscription)
        useViewStateStore.getState().setCrosshair([1, 2, 3]);
        
        // Change layer visibility (should only affect full subscription)
        useViewStateStore.getState().setViewState(state => {
          if (state.layers[0]) {
            state.layers[0].visible = false;
          }
        });
        
        // Change camera settings (should only affect full subscription)
        useViewStateStore.getState().setViewState(state => {
          state.views.axial.fov_mm = [250, 250];
        });
        
        // Change timepoint (should affect both)
        useViewStateStore.getState().setViewState(state => {
          state.timepoint = 10;
        });
      });
      
      // Full subscription component re-renders for every change
      expect(fullSubscriptionRenders).toBe(4);
      
      // Selective subscription only re-renders for timepoint change
      expect(selectiveSubscriptionRenders).toBe(1);
      
      // Calculate reduction
      const reduction = 1 - (selectiveSubscriptionRenders / fullSubscriptionRenders);
      expect(reduction).toBeGreaterThanOrEqual(0.6); // At least 60% reduction
    });
  });

  describe('View-Specific Selectors', () => {
    test('should only update when specific view changes', () => {
      const axialMonitor = new RenderFrequencyMonitor();
      const sagittalMonitor = new RenderFrequencyMonitor();
      
      const { result: axialResult } = renderHook(() => {
        axialMonitor.recordRender();
        return useViewDataSelector('axial');
      });
      
      const { result: sagittalResult } = renderHook(() => {
        sagittalMonitor.recordRender();
        return useViewDataSelector('sagittal');
      });
      
      // Change axial view
      act(() => {
        useViewStateStore.getState().setViewState(state => {
          state.views.axial.fov_mm = [300, 300];
        });
      });
      
      // Only axial should re-render
      expect(axialMonitor.getRenderCount()).toBe(2); // Initial + update
      expect(sagittalMonitor.getRenderCount()).toBe(1); // Only initial
    });
  });

  describe('Render Data Selector', () => {
    test('should filter out non-visible layers', () => {
      const { result } = renderHook(() => useRenderDataSelector());
      
      // Add layers with different visibility
      act(() => {
        useViewStateStore.getState().setViewState(state => {
          state.layers = [
            { id: 'layer1', visible: true, opacity: 1.0 },
            { id: 'layer2', visible: false, opacity: 1.0 }, // Not visible
            { id: 'layer3', visible: true, opacity: 0.0 }, // Zero opacity
            { id: 'layer4', visible: true, opacity: 0.5 },
          ];
        });
      });
      
      // Should only include visible layers with opacity > 0
      expect(result.current.layers).toHaveLength(2);
      expect(result.current.layers[0].id).toBe('layer1');
      expect(result.current.layers[1].id).toBe('layer4');
    });

    test('should batch related data for rendering', () => {
      const { result } = renderHook(() => useRenderDataSelector());
      
      // Verify all render-relevant data is included
      expect(result.current).toHaveProperty('layers');
      expect(result.current).toHaveProperty('crosshairVisible');
      expect(result.current).toHaveProperty('timepoint');
      
      // Should use shallow comparison to prevent unnecessary updates
      const prevResult = result.current;
      
      // Update something unrelated
      act(() => {
        useViewStateStore.getState().setViewState(state => {
          state.views.axial.origin_mm = [1, 2, 3];
        });
      });
      
      // Result should be the same object (no re-render)
      expect(result.current).toBe(prevResult);
    });
  });

  describe('Performance Impact', () => {
    test('should reduce total re-render time', async () => {
      const measurements = {
        full: [] as number[],
        selective: [] as number[],
      };
      
      // Measure full subscription render time
      const FullComponent = () => {
        const start = performance.now();
        const viewState = useViewStateStore(state => state.viewState);
        measurements.full.push(performance.now() - start);
        return <div>{JSON.stringify(viewState)}</div>;
      };
      
      // Measure selective subscription render time
      const SelectiveComponent = () => {
        const start = performance.now();
        const timepoint = useTimepointSelector();
        const crosshair = useCrosshairSelector();
        measurements.selective.push(performance.now() - start);
        return <div>{timepoint} {JSON.stringify(crosshair)}</div>;
      };
      
      render(<FullComponent />);
      render(<SelectiveComponent />);
      
      // Trigger multiple updates
      for (let i = 0; i < 10; i++) {
        act(() => {
          useViewStateStore.getState().setViewState(state => {
            state.timepoint = i;
            state.crosshair.world_mm = [i, i, i];
          });
        });
      }
      
      // Calculate average render times
      const avgFull = measurements.full.reduce((a, b) => a + b) / measurements.full.length;
      const avgSelective = measurements.selective.reduce((a, b) => a + b) / measurements.selective.length;
      
      // Selective should be faster
      expect(avgSelective).toBeLessThan(avgFull);
    });
  });
});