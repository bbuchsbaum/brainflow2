/**
 * Annotation Store
 * Manages all annotations with CRUD operations and visibility control
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { subscribeWithSelector } from 'zustand/middleware';
import { enableMapSet } from 'immer';
import type { Annotation } from '@/types/annotations';
import { getEventBus } from '@/events/EventBus';

// Enable Map and Set support in Immer
enableMapSet();

interface AnnotationState {
  // Core state
  annotations: Map<string, Annotation>;
  selectedIds: Set<string>;
  hoveredId: string | null;
  
  // Visibility control
  visibility: {
    marker: boolean;
    roi: boolean;
    measurement: boolean;
    label: boolean;
  };
  
  // Group management
  groups: Map<string, {
    name: string;
    visible: boolean;
    color: string;
  }>;
  
  // Actions
  addAnnotation: (annotation: Annotation) => void;
  removeAnnotation: (id: string) => void;
  updateAnnotation: (id: string, updates: Partial<Annotation>) => void;
  
  // Selection
  selectAnnotations: (ids: string[]) => void;
  clearSelection: () => void;
  toggleSelection: (id: string) => void;
  setHovered: (id: string | null) => void;
  
  // Visibility
  setTypeVisibility: (type: Annotation['type'], visible: boolean) => void;
  setGroupVisibility: (groupId: string, visible: boolean) => void;
  
  // Group management
  createGroup: (id: string, name: string, color: string) => void;
  removeGroup: (id: string) => void;
  
  // Bulk operations
  removeSelected: () => void;
  hideSelected: () => void;
  showAll: () => void;
  
  // Queries
  getVisibleAnnotations: () => Annotation[];
  getAnnotationsByGroup: (groupId: string) => Annotation[];
  getSelectedAnnotations: () => Annotation[];
}

export const useAnnotationStore = create<AnnotationState>()(
  subscribeWithSelector(
    immer((set, get) => ({
      // Initial state
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
      
      // Actions
      addAnnotation: (annotation) => {
        set((state) => {
          state.annotations.set(annotation.id, annotation);
        });
        
        const eventBus = getEventBus();
        eventBus.emit('annotation.added', { annotation });
      },
      
      removeAnnotation: (id) => {
        const annotation = get().annotations.get(id);
        if (!annotation) return;
        
        set((state) => {
          state.annotations.delete(id);
          state.selectedIds.delete(id);
          if (state.hoveredId === id) {
            state.hoveredId = null;
          }
        });
        
        const eventBus = getEventBus();
        eventBus.emit('annotation.removed', { annotationId: id });
      },
      
      updateAnnotation: (id, updates) => {
        const annotation = get().annotations.get(id);
        if (!annotation) return;
        
        set((state) => {
          const existing = state.annotations.get(id);
          if (existing) {
            Object.assign(existing, updates);
          }
        });
        
        const updated = get().annotations.get(id);
        if (updated) {
          const eventBus = getEventBus();
          eventBus.emit('annotation.updated', { annotationId: id, annotation: updated });
        }
      },
      
      // Selection
      selectAnnotations: (ids) => {
        set((state) => {
          state.selectedIds = new Set(ids);
        });
        
        const eventBus = getEventBus();
        eventBus.emit('annotation.selected', { annotationIds: ids });
      },
      
      clearSelection: () => {
        set((state) => {
          state.selectedIds.clear();
        });
        
        const eventBus = getEventBus();
        eventBus.emit('annotation.selected', { annotationIds: [] });
      },
      
      toggleSelection: (id) => {
        set((state) => {
          if (state.selectedIds.has(id)) {
            state.selectedIds.delete(id);
          } else {
            state.selectedIds.add(id);
          }
        });
        
        const selectedIds = Array.from(get().selectedIds);
        const eventBus = getEventBus();
        eventBus.emit('annotation.selected', { annotationIds: selectedIds });
      },
      
      setHovered: (id) => {
        set((state) => {
          state.hoveredId = id;
        });
        
        const eventBus = getEventBus();
        eventBus.emit('annotation.hover', { annotationId: id });
      },
      
      // Visibility
      setTypeVisibility: (type, visible) => {
        set((state) => {
          state.visibility[type] = visible;
        });
      },
      
      setGroupVisibility: (groupId, visible) => {
        set((state) => {
          const group = state.groups.get(groupId);
          if (group) {
            group.visible = visible;
          }
        });
      },
      
      // Group management
      createGroup: (id, name, color) => {
        set((state) => {
          state.groups.set(id, { name, visible: true, color });
        });
      },
      
      removeGroup: (id) => {
        set((state) => {
          state.groups.delete(id);
          // Remove group from all annotations
          state.annotations.forEach((annotation) => {
            if (annotation.group === id) {
              delete annotation.group;
            }
          });
        });
      },
      
      // Bulk operations
      removeSelected: () => {
        const selectedIds = Array.from(get().selectedIds);
        selectedIds.forEach(id => {
          get().removeAnnotation(id);
        });
      },
      
      hideSelected: () => {
        const selectedIds = get().selectedIds;
        set((state) => {
          selectedIds.forEach(id => {
            const annotation = state.annotations.get(id);
            if (annotation) {
              annotation.visible = false;
            }
          });
        });
      },
      
      showAll: () => {
        set((state) => {
          state.annotations.forEach(annotation => {
            annotation.visible = true;
          });
        });
      },
      
      // Queries
      getVisibleAnnotations: () => {
        const state = get();
        return Array.from(state.annotations.values()).filter(annotation => {
          // Check type visibility
          if (!state.visibility[annotation.type]) return false;
          
          // Check individual visibility
          if (!annotation.visible) return false;
          
          // Check group visibility
          if (annotation.group) {
            const group = state.groups.get(annotation.group);
            if (group && !group.visible) return false;
          }
          
          return true;
        });
      },
      
      getAnnotationsByGroup: (groupId) => {
        return Array.from(get().annotations.values()).filter(
          annotation => annotation.group === groupId
        );
      },
      
      getSelectedAnnotations: () => {
        const state = get();
        return Array.from(state.selectedIds)
          .map(id => state.annotations.get(id))
          .filter((annotation): annotation is Annotation => annotation !== undefined);
      },
    }))
  )
);

// Helper function to generate unique IDs
export function generateAnnotationId(): string {
  return `ann_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Z-order utilities
export function sortAnnotationsByZOrder(annotations: Annotation[]): Annotation[] {
  // Define z-order by type
  const typeOrder: Record<Annotation['type'], number> = {
    roi: 0,
    measurement: 1,
    marker: 2,
    label: 3,
  };
  
  return annotations.sort((a, b) => {
    // First sort by type
    const typeOrderDiff = typeOrder[a.type] - typeOrder[b.type];
    if (typeOrderDiff !== 0) return typeOrderDiff;
    
    // Then by selection state (selected on top)
    if (a.selected && !b.selected) return 1;
    if (!a.selected && b.selected) return -1;
    
    // Finally by ID for stability
    return a.id.localeCompare(b.id);
  });
}