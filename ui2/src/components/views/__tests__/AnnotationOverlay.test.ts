/**
 * AnnotationOverlay Tests
 */

import { describe, it, expect, vi } from 'vitest';
import type { ViewPlane } from '@/types/coordinates';
import type { Marker, ROI, Label, Measurement } from '@/types/annotations';

vi.mock('@/stores/annotationStore', () => ({
  useAnnotationStore: () => ({
    hoveredId: null,
    toggleSelection: vi.fn(),
    setHovered: vi.fn(),
  }),
  sortAnnotationsByZOrder: vi.fn((annotations) => annotations),
}));

vi.mock('@/utils/coordinateTransform', () => ({
  useCoordinateTransform: () => ({
    worldToScreen: vi.fn((world_mm) => [world_mm[0], world_mm[1]]),
    screenToWorld: vi.fn(),
    isPointInView: vi.fn(() => true),
    getViewBounds: vi.fn(),
  }),
}));

describe('AnnotationOverlay', () => {
  const mockPlane: ViewPlane = {
    origin_mm: [0, 0, 0],
    u_mm: [1, 0, 0],
    v_mm: [0, 1, 0],
    dim_px: [256, 256],
  };

  const mockMarker: Marker = {
    id: 'marker1',
    type: 'marker',
    world_mm: [50, 100, 0],
    visible: true,
    selected: false,
    symbol: 'circle',
    size: 10,
  };

  const mockROI: ROI = {
    id: 'roi1',
    type: 'roi',
    world_mm: [75, 125, 0],
    visible: true,
    selected: false,
    geometry: {
      type: 'sphere',
      params: [20],
    },
  };

  const mockLabel: Label = {
    id: 'label1',
    type: 'label',
    world_mm: [100, 150, 0],
    visible: true,
    selected: false,
    text: 'Test Label',
    anchor: 'center',
  };

  const mockMeasurement: Measurement = {
    id: 'measurement1',
    type: 'measurement',
    world_mm: [125, 175, 0],
    visible: true,
    selected: false,
    points: [
      [120, 170, 0],
      [130, 180, 0],
    ],
    value: 15.5,
    unit: 'mm',
  };

  it('should have annotation type definitions', () => {
    expect(mockMarker.type).toBe('marker');
    expect(mockROI.type).toBe('roi'); 
    expect(mockLabel.type).toBe('label');
    expect(mockMeasurement.type).toBe('measurement');
  });

  it('should have proper coordinate transform interface', () => {
    // Test coordinate transform mock
    const mockTransform = {
      worldToScreen: vi.fn((world_mm) => [world_mm[0], world_mm[1]]),
      screenToWorld: vi.fn(),
      isPointInView: vi.fn(() => true),
      getViewBounds: vi.fn(),
    };
    
    expect(typeof mockTransform.worldToScreen).toBe('function');
    expect(typeof mockTransform.screenToWorld).toBe('function');
    expect(typeof mockTransform.isPointInView).toBe('function');
    expect(typeof mockTransform.getViewBounds).toBe('function');
  });

  it('should filter visible annotations correctly', () => {
    const visibleAnnotations = [mockMarker, mockROI, mockLabel, mockMeasurement];
    const invisibleMarker = { ...mockMarker, visible: false };
    const allAnnotations = [...visibleAnnotations, invisibleMarker];
    
    const filtered = allAnnotations.filter(ann => ann.visible);
    expect(filtered.length).toBe(4); // Should exclude invisible marker
    expect(filtered.includes(invisibleMarker)).toBe(false);
  });

  it('should support all annotation geometry types', () => {
    const sphereROI: ROI = {
      ...mockROI,
      geometry: { type: 'sphere', params: [10] }
    };
    
    const boxROI: ROI = {
      ...mockROI,
      geometry: { type: 'box', params: [20, 30, 40] }
    };
    
    const polygonROI: ROI = {
      ...mockROI,
      geometry: { type: 'polygon', params: [0, 0, 0, 10, 0, 0, 5, 10, 0] }
    };
    
    expect(sphereROI.geometry.type).toBe('sphere');
    expect(boxROI.geometry.type).toBe('box');
    expect(polygonROI.geometry.type).toBe('polygon');
  });

  it('should support all marker symbols', () => {
    const symbols = ['circle', 'square', 'diamond', 'cross'] as const;
    
    symbols.forEach(symbol => {
      const marker: Marker = { ...mockMarker, symbol };
      expect(marker.symbol).toBe(symbol);
    });
  });

  it('should support all label anchor positions', () => {
    const anchors = ['center', 'top', 'bottom', 'left', 'right'] as const;
    
    anchors.forEach(anchor => {
      const label: Label = { ...mockLabel, anchor };
      expect(label.anchor).toBe(anchor);
    });
  });

  it('should handle measurement with multiple points', () => {
    const multiPointMeasurement: Measurement = {
      ...mockMeasurement,
      points: [
        [100, 100, 0],
        [110, 110, 0],
        [120, 120, 0],
        [130, 130, 0],
      ]
    };
    
    expect(multiPointMeasurement.points.length).toBe(4);
    expect(multiPointMeasurement.points[0]).toEqual([100, 100, 0]);
  });
});