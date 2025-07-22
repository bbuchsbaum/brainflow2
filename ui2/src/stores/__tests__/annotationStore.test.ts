/**
 * Annotation Store Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAnnotationStore, generateAnnotationId, sortAnnotationsByZOrder } from '../annotationStore';
import type { Marker, ROI, Label } from '@/types/annotations';
import { getEventBus } from '@/events/EventBus';

vi.mock('@/events/EventBus');

describe('AnnotationStore', () => {
  beforeEach(() => {
    // Reset store
    useAnnotationStore.setState({
      annotations: new Map(),
      selectedIds: new Set(),
      hoveredId: null,
      visibility: {
        marker: true,
        roi: true,
        measurement: true,
        label: true,
      },
      groups: new Map(),
    });
    
    // Clear mocks
    vi.clearAllMocks();
  });

  describe('CRUD operations', () => {
    it('should add annotation', () => {
      const mockEmit = vi.fn();
      (getEventBus as any).mockReturnValue({ emit: mockEmit });
      
      const marker: Marker = {
        id: 'marker1',
        type: 'marker',
        world_mm: [10, 20, 30],
        visible: true,
        selected: false,
        symbol: 'circle',
        size: 5,
      };
      
      // Destructure action and call it
      const { addAnnotation } = useAnnotationStore.getState();
      addAnnotation(marker);
      
      // Get fresh state for assertions
      const state = useAnnotationStore.getState();
      expect(state.annotations.get('marker1')).toEqual(marker);
      expect(mockEmit).toHaveBeenCalledWith('annotation.added', { annotation: marker });
    });

    it('should remove annotation', () => {
      const mockEmit = vi.fn();
      (getEventBus as any).mockReturnValue({ emit: mockEmit });
      
      // Add annotation first
      const marker: Marker = {
        id: 'marker1',
        type: 'marker',
        world_mm: [10, 20, 30],
        visible: true,
        selected: false,
        symbol: 'circle',
        size: 5,
      };
      const { addAnnotation, removeAnnotation } = useAnnotationStore.getState();
      addAnnotation(marker);
      
      // Clear mock calls from adding
      mockEmit.mockClear();
      
      removeAnnotation('marker1');
      
      const state = useAnnotationStore.getState();
      expect(state.annotations.has('marker1')).toBe(false);
      expect(mockEmit).toHaveBeenCalledWith('annotation.removed', { annotationId: 'marker1' });
    });

    it('should update annotation', () => {
      const mockEmit = vi.fn();
      (getEventBus as any).mockReturnValue({ emit: mockEmit });
      
      const marker: Marker = {
        id: 'marker1',
        type: 'marker',
        world_mm: [10, 20, 30],
        visible: true,
        selected: false,
        symbol: 'circle',
        size: 5,
      };
      const { addAnnotation, updateAnnotation } = useAnnotationStore.getState();
      addAnnotation(marker);
      
      // Clear mock calls from adding
      mockEmit.mockClear();
      
      updateAnnotation('marker1', { 
        visible: false, 
        world_mm: [15, 25, 35] 
      });
      
      const state = useAnnotationStore.getState();
      const updated = state.annotations.get('marker1');
      expect(updated?.visible).toBe(false);
      expect(updated?.world_mm).toEqual([15, 25, 35]);
      expect(mockEmit).toHaveBeenCalledWith('annotation.updated', {
        annotationId: 'marker1',
        annotation: expect.objectContaining({ visible: false })
      });
    });
  });

  describe('selection management', () => {
    it('should select annotations', () => {
      const mockEmit = vi.fn();
      (getEventBus as any).mockReturnValue({ emit: mockEmit });
      
      const { selectAnnotations } = useAnnotationStore.getState();
      selectAnnotations(['ann1', 'ann2']);
      
      const state = useAnnotationStore.getState();
      expect(state.selectedIds).toEqual(new Set(['ann1', 'ann2']));
      expect(mockEmit).toHaveBeenCalledWith('annotation.selected', { 
        annotationIds: ['ann1', 'ann2'] 
      });
    });

    it('should toggle selection', () => {
      const mockEmit = vi.fn();
      (getEventBus as any).mockReturnValue({ emit: mockEmit });
      
      const { toggleSelection } = useAnnotationStore.getState();
      
      // First toggle - should select
      toggleSelection('ann1');
      let state = useAnnotationStore.getState();
      expect(state.selectedIds.has('ann1')).toBe(true);
      
      // Second toggle - should deselect
      toggleSelection('ann1');
      state = useAnnotationStore.getState();
      expect(state.selectedIds.has('ann1')).toBe(false);
    });

    it('should clear selection', () => {
      const { selectAnnotations, clearSelection } = useAnnotationStore.getState();
      
      // First select some annotations
      selectAnnotations(['ann1', 'ann2']);
      let state = useAnnotationStore.getState();
      expect(state.selectedIds.size).toBe(2);
      
      clearSelection();
      
      state = useAnnotationStore.getState();
      expect(state.selectedIds.size).toBe(0);
    });
  });

  describe('visibility control', () => {
    it('should control type visibility', () => {
      const { setTypeVisibility } = useAnnotationStore.getState();
      
      setTypeVisibility('marker', false);
      let state = useAnnotationStore.getState();
      expect(state.visibility.marker).toBe(false);
      
      setTypeVisibility('marker', true);
      state = useAnnotationStore.getState();
      expect(state.visibility.marker).toBe(true);
    });

    it('should filter visible annotations', () => {
      const marker: Marker = {
        id: 'marker1',
        type: 'marker',
        world_mm: [0, 0, 0],
        visible: true,
        selected: false,
        symbol: 'circle',
        size: 5,
      };
      
      const roi: ROI = {
        id: 'roi1',
        type: 'roi',
        world_mm: [0, 0, 0],
        visible: true,
        selected: false,
        geometry: { type: 'sphere', params: [10] },
      };
      
      const hiddenLabel: Label = {
        id: 'label1',
        type: 'label',
        world_mm: [0, 0, 0],
        visible: false, // Individually hidden
        selected: false,
        text: 'Test',
        anchor: 'center',
      };
      
      const { addAnnotation, setTypeVisibility, getVisibleAnnotations } = useAnnotationStore.getState();
      addAnnotation(marker);
      addAnnotation(roi);
      addAnnotation(hiddenLabel);
      
      // Hide markers by type
      setTypeVisibility('marker', false);
      
      const visible = getVisibleAnnotations();
      expect(visible).toHaveLength(1);
      expect(visible[0].id).toBe('roi1');
    });
  });

  describe('group management', () => {
    it('should create and manage groups', () => {
      const { createGroup } = useAnnotationStore.getState();
      
      createGroup('group1', 'Lesions', '#ff0000');
      
      const state = useAnnotationStore.getState();
      expect(state.groups.get('group1')).toEqual({
        name: 'Lesions',
        visible: true,
        color: '#ff0000',
      });
    });

    it('should control group visibility', () => {
      // Create group
      const { createGroup, addAnnotation, setGroupVisibility, getVisibleAnnotations } = useAnnotationStore.getState();
      createGroup('group1', 'Test Group', '#00ff00');
      
      // Add annotation to group
      const marker: Marker = {
        id: 'marker1',
        type: 'marker',
        world_mm: [0, 0, 0],
        visible: true,
        selected: false,
        symbol: 'circle',
        size: 5,
        group: 'group1',
      };
      addAnnotation(marker);
      
      // Hide group
      setGroupVisibility('group1', false);
      
      const visible = getVisibleAnnotations();
      expect(visible).toHaveLength(0);
    });

    it('should remove group and clean up annotations', () => {
      // Create group and annotation
      const { createGroup, addAnnotation, removeGroup } = useAnnotationStore.getState();
      createGroup('group1', 'Test Group', '#00ff00');
      const marker: Marker = {
        id: 'marker1',
        type: 'marker',
        world_mm: [0, 0, 0],
        visible: true,
        selected: false,
        symbol: 'circle',
        size: 5,
        group: 'group1',
      };
      addAnnotation(marker);
      
      // Remove group
      removeGroup('group1');
      
      const state = useAnnotationStore.getState();
      expect(state.groups.has('group1')).toBe(false);
      expect(state.annotations.get('marker1')?.group).toBeUndefined();
    });
  });

  describe('bulk operations', () => {
    it('should remove selected annotations', () => {
      const mockEmit = vi.fn();
      (getEventBus as any).mockReturnValue({ emit: mockEmit });
      
      const { addAnnotation, selectAnnotations, removeSelected } = useAnnotationStore.getState();
      
      // Add annotations
      ['ann1', 'ann2', 'ann3'].forEach(id => {
        const marker: Marker = {
          id,
          type: 'marker',
          world_mm: [0, 0, 0],
          visible: true,
          selected: false,
          symbol: 'circle',
          size: 5,
        };
        addAnnotation(marker);
      });
      
      // Select some
      selectAnnotations(['ann1', 'ann3']);
      
      // Remove selected
      removeSelected();
      
      const state = useAnnotationStore.getState();
      expect(state.annotations.size).toBe(1);
      expect(state.annotations.has('ann2')).toBe(true);
      expect(state.selectedIds.size).toBe(0);
    });

    it('should hide selected annotations', () => {
      const { addAnnotation, selectAnnotations, hideSelected } = useAnnotationStore.getState();
      
      // Add annotations
      ['ann1', 'ann2'].forEach(id => {
        const marker: Marker = {
          id,
          type: 'marker',
          world_mm: [0, 0, 0],
          visible: true,
          selected: false,
          symbol: 'circle',
          size: 5,
        };
        addAnnotation(marker);
      });
      
      // Select and hide
      selectAnnotations(['ann1']);
      hideSelected();
      
      const state = useAnnotationStore.getState();
      expect(state.annotations.get('ann1')?.visible).toBe(false);
      expect(state.annotations.get('ann2')?.visible).toBe(true);
    });
  });

  describe('helper functions', () => {
    it('should generate unique IDs', () => {
      const id1 = generateAnnotationId();
      const id2 = generateAnnotationId();
      
      expect(id1).toMatch(/^ann_\d+_[a-z0-9]+$/);
      expect(id1).not.toBe(id2);
    });

    it('should sort annotations by z-order', () => {
      const annotations = [
        { id: 'label1', type: 'label', selected: false } as Label,
        { id: 'marker1', type: 'marker', selected: true } as Marker,
        { id: 'roi1', type: 'roi', selected: false } as ROI,
        { id: 'marker2', type: 'marker', selected: false } as Marker,
      ];
      
      const sorted = sortAnnotationsByZOrder(annotations);
      
      // ROIs should be first (bottom)
      expect(sorted[0].type).toBe('roi');
      // Regular marker next
      expect(sorted[1].type).toBe('marker');
      expect(sorted[1].selected).toBe(false);
      // Selected marker after regular marker
      expect(sorted[2].type).toBe('marker');
      expect(sorted[2].selected).toBe(true);
      // Labels on top
      expect(sorted[3].type).toBe('label');
    });
  });
});