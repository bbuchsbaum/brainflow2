/**
 * Run 6 N35: with fsaverage6 pial lh + rh in one tab (bound to lh) and the
 * Medial preset, selecting the rh row in the Inspector must aim the presets
 * at rh: the canvas gets viewHemisphere 'right' and the header names the
 * right hemisphere. The tab's render anchor stays lh.
 */
import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSurfaceStore, type LoadedSurface } from '@/stores/surfaceStore';
import { useActivePanelStore } from '@/stores/activePanelStore';
import { useActiveRenderContextStore } from '@/stores/activeRenderContextStore';
import { useInspectorSelectionStore } from '@/stores/inspectorSelectionStore';
import type { SceneItem } from '@/types/sceneItem';

import type { NeuroSurfaceCanvasProps } from '@brainflow/visualization/surface';

const canvasState = vi.hoisted(() => ({ latestProps: null as NeuroSurfaceCanvasProps | null }));

vi.mock('../surfaceViewer', async () => {
  const React = await import('react');
  return {
    NeuroSurfaceCanvas: (props: NeuroSurfaceCanvasProps) => {
      canvasState.latestProps = props;
      return React.createElement('div', {
        'data-testid': 'neuro-surface-canvas',
        onPointerDown: props.onActivate,
      });
    },
  };
});

import { SurfaceViewPanel } from '../SurfaceViewPanel';

function templateSurface(handle: string, hemisphere: 'left' | 'right'): LoadedSurface {
  return {
    handle,
    name: `fsaverage6_pial_${hemisphere}`,
    visible: true,
    geometry: {
      vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      faces: new Uint32Array([0, 1, 2]),
      hemisphere,
      surfaceType: 'pial',
    },
    layers: new Map(),
    metadata: {
      vertexCount: 3,
      faceCount: 1,
      hemisphere,
      surfaceType: 'pial',
      path: `templateflow://fsaverage6_pial_${hemisphere}`,
    },
  };
}

const rhRow: SceneItem = {
  id: 'rh',
  kind: 'surface-geometry',
  group: 'surface',
  name: 'fsaverage6_pial_right',
  subtitle: 'surface geometry',
  visible: true,
  opacity: 1,
  ref: { type: 'surface-geometry', surfaceId: 'rh' },
};

function header(): string {
  return screen.getByTestId('surface-frame-header').textContent ?? '';
}

describe('SurfaceViewPanel preset hemisphere follows the selection', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    canvasState.latestProps = null;
    useInspectorSelectionStore.getState().clear();
    // The Inspector has focus: no explicit surface view is active.
    useActivePanelStore.setState({ componentType: null, componentState: null });
    useActiveRenderContextStore.setState({ activeId: null });
    useSurfaceStore.setState({
      surfaces: new Map([
        ['lh', templateSurface('lh', 'left')],
        ['rh', templateSurface('rh', 'right')],
      ]),
      activeSurfaceId: null,
      selectedItemType: null,
      selectedLayerId: null,
      isLoading: false,
      loadError: null,
      viewpoint: 'medial',
      surfaceViewViewpoints: new Map([['pair-view', 'medial']]),
      surfaceViewSettings: new Map(),
      surfaceViewHandles: new Map(),
      surfaceViewSelections: new Map(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('an Inspector rh row click flips Medial to the right wall', () => {
    render(
      <SurfaceViewPanel
        surfaceHandle="lh"
        surfaceViewId="pair-view"
        groupKey="templateflow://fsaverage6_pial"
      />,
    );
    expect(canvasState.latestProps!.viewHemisphere).toBe('left');
    expect(header()).toContain('left');
    expect(canvasState.latestProps!.surfaces.map((s) => s.handle)).toEqual([
      'lh',
      'rh',
    ]);

    act(() => {
      useInspectorSelectionStore.getState().setActive(rhRow);
    });

    expect(canvasState.latestProps!.viewHemisphere).toBe('right');
    expect(header()).toContain('right');
    expect(header()).not.toContain('left');
    // Pairing is unchanged: both hemispheres are still drawn.
    expect(canvasState.latestProps!.surfaces.map((s) => s.handle)).toEqual([
      'lh',
      'rh',
    ]);
    expect(useSurfaceStore.getState().surfaceViewHandles.get('pair-view')).toBe('lh');

    // Clicking into the canvas keeps the selected hemisphere.
    act(() => {
      canvasState.latestProps!.onActivate?.();
    });
    expect(canvasState.latestProps!.viewHemisphere).toBe('right');
  });
});
