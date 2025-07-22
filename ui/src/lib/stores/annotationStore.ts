/**
 * Svelte store for managing annotations across all views
 * 
 * This store maintains the global state of all annotations and provides
 * methods for CRUD operations, selection, and bulk updates.
 */

import { writable, derived, get } from 'svelte/store';
import type { 
  Annotation, 
  AnnotationGroup, 
  TextAnnotation, 
  MarkerAnnotation,
  LineAnnotation,
  ROIAnnotation,
  MeasurementAnnotation
} from '$lib/types/annotations';
import { nanoid } from 'nanoid';

// State type definitions
type ToolMode = 'select' | 'text' | 'marker' | 'line' | 'roi' | 'measure' | null;

// Create the writable stores for annotation state
const annotations = writable<Map<string, Annotation>>(new Map());
const groups = writable<Map<string, AnnotationGroup>>(new Map());
const selectedAnnotationIds = writable<Set<string>>(new Set());
const hoveredAnnotationId = writable<string | null>(null);
const activeToolMode = writable<ToolMode>(null);

// Create derived stores for commonly accessed data
export const visibleAnnotations = derived(annotations, $annotations => 
  Array.from($annotations.values()).filter(a => a.visible)
);

export const selectedAnnotations = derived(
  [annotations, selectedAnnotationIds],
  ([$annotations, $selectedIds]) => 
    Array.from($selectedIds)
      .map(id => $annotations.get(id))
      .filter((a): a is Annotation => a !== undefined)
);

// Create the annotation store with all methods
function createAnnotationStore() {
  // Add annotation
  const addAnnotation = (annotationData: Omit<Annotation, 'id' | 'createdAt' | 'modifiedAt'>) => {
    const id = nanoid();
    const now = Date.now();
    const annotation: Annotation = {
      ...annotationData,
      id,
      createdAt: now,
      modifiedAt: now,
      visible: true,
    } as Annotation;
    
    annotations.update(currentAnnotations => {
      const newAnnotations = new Map(currentAnnotations);
      newAnnotations.set(id, annotation);
      return newAnnotations;
    });
    
    return id;
  };
  
  // Update annotation
  const updateAnnotation = (id: string, updates: Partial<Annotation>) => {
    annotations.update(currentAnnotations => {
      const annotation = currentAnnotations.get(id);
      if (!annotation || annotation.locked) return currentAnnotations;
      
      const newAnnotations = new Map(currentAnnotations);
      newAnnotations.set(id, {
        ...annotation,
        ...updates,
        id: annotation.id, // Prevent ID change
        type: annotation.type, // Prevent type change
        modifiedAt: Date.now(),
      });
      
      return newAnnotations;
    });
  };
  
  // Remove annotation
  const removeAnnotation = (id: string) => {
    const annotation = get(annotations).get(id);
    if (!annotation || annotation.locked) return;
    
    annotations.update(currentAnnotations => {
      const newAnnotations = new Map(currentAnnotations);
      newAnnotations.delete(id);
      return newAnnotations;
    });
    
    selectedAnnotationIds.update(currentIds => {
      const newIds = new Set(currentIds);
      newIds.delete(id);
      return newIds;
    });
    
    // Remove from groups
    groups.update(currentGroups => {
      const newGroups = new Map(currentGroups);
      newGroups.forEach((group) => {
        const index = group.annotationIds.indexOf(id);
        if (index !== -1) {
          group.annotationIds.splice(index, 1);
        }
      });
      return newGroups;
    });
    
    // Clear hover if needed
    const currentHoveredId = get(hoveredAnnotationId);
    if (currentHoveredId === id) {
      hoveredAnnotationId.set(null);
    }
  };
  
  // Remove multiple annotations
  const removeAnnotations = (ids: string[]) => {
    ids.forEach(id => removeAnnotation(id));
  };
  
  // Clear all annotations
  const clearAnnotations = () => {
    annotations.set(new Map());
    selectedAnnotationIds.set(new Set());
    hoveredAnnotationId.set(null);
  };
  
  // Selection operations
  const selectAnnotation = (id: string, multi = false) => {
    const annotation = get(annotations).get(id);
    if (!annotation) return;
    
    selectedAnnotationIds.update(currentIds => {
      const newIds = multi ? new Set(currentIds) : new Set<string>();
      newIds.add(id);
      return newIds;
    });
  };
  
  const deselectAnnotation = (id: string) => {
    selectedAnnotationIds.update(currentIds => {
      const newIds = new Set(currentIds);
      newIds.delete(id);
      return newIds;
    });
  };
  
  const selectAnnotations = (ids: string[]) => {
    selectedAnnotationIds.set(new Set(ids));
  };
  
  const clearSelection = () => {
    selectedAnnotationIds.set(new Set());
  };
  
  const selectAll = () => {
    const allIds = new Set(get(annotations).keys());
    selectedAnnotationIds.set(allIds);
  };
  
  // Visibility operations
  const toggleVisibility = (id: string) => {
    const annotation = get(annotations).get(id);
    if (annotation) {
      updateAnnotation(id, { visible: !annotation.visible });
    }
  };
  
  const setVisibility = (id: string, visible: boolean) => {
    updateAnnotation(id, { visible });
  };
  
  const showAll = () => {
    annotations.update(currentAnnotations => {
      const newAnnotations = new Map(currentAnnotations);
      newAnnotations.forEach((annotation) => {
        annotation.visible = true;
      });
      return newAnnotations;
    });
  };
  
  const hideAll = () => {
    annotations.update(currentAnnotations => {
      const newAnnotations = new Map(currentAnnotations);
      newAnnotations.forEach((annotation) => {
        annotation.visible = false;
      });
      return newAnnotations;
    });
  };
  
  // Group operations
  const createGroup = (name: string, annotationIds: string[] = []) => {
    const id = nanoid();
    const group: AnnotationGroup = {
      id,
      name,
      visible: true,
      annotationIds,
    };
    
    groups.update(currentGroups => {
      const newGroups = new Map(currentGroups);
      newGroups.set(id, group);
      return newGroups;
    });
    
    return id;
  };
  
  const addToGroup = (groupId: string, annotationIds: string[]) => {
    groups.update(currentGroups => {
      const group = currentGroups.get(groupId);
      if (!group) return currentGroups;
      
      const newGroups = new Map(currentGroups);
      const updatedGroup = {
        ...group,
        annotationIds: [...new Set([...group.annotationIds, ...annotationIds])],
      };
      newGroups.set(groupId, updatedGroup);
      
      return newGroups;
    });
  };
  
  const removeFromGroup = (groupId: string, annotationIds: string[]) => {
    groups.update(currentGroups => {
      const group = currentGroups.get(groupId);
      if (!group) return currentGroups;
      
      const newGroups = new Map(currentGroups);
      const updatedGroup = {
        ...group,
        annotationIds: group.annotationIds.filter(id => !annotationIds.includes(id)),
      };
      newGroups.set(groupId, updatedGroup);
      
      return newGroups;
    });
  };
  
  const deleteGroup = (groupId: string) => {
    groups.update(currentGroups => {
      const newGroups = new Map(currentGroups);
      newGroups.delete(groupId);
      return newGroups;
    });
  };
  
  const toggleGroupVisibility = (groupId: string) => {
    const group = get(groups).get(groupId);
    if (!group) return;
    
    groups.update(currentGroups => {
      const newGroups = new Map(currentGroups);
      const updatedGroup = { ...group, visible: !group.visible };
      newGroups.set(groupId, updatedGroup);
      return newGroups;
    });
    
    // Update visibility of annotations in the group
    annotations.update(currentAnnotations => {
      const newAnnotations = new Map(currentAnnotations);
      group.annotationIds.forEach(annotationId => {
        const annotation = newAnnotations.get(annotationId);
        if (annotation) {
          annotation.visible = !group.visible;
        }
      });
      return newAnnotations;
    });
  };
  
  // Hover state
  const setHoveredAnnotation = (id: string | null) => {
    hoveredAnnotationId.set(id);
  };
  
  // Tool mode
  const setActiveToolMode = (mode: ToolMode) => {
    activeToolMode.set(mode);
  };
  
  // Bulk operations
  const importAnnotations = (importedAnnotations: Annotation[], replace = false) => {
    annotations.update(currentAnnotations => {
      const newAnnotations = replace ? new Map() : new Map(currentAnnotations);
      const now = Date.now();
      
      importedAnnotations.forEach((annotation) => {
        const id = annotation.id || nanoid();
        newAnnotations.set(id, {
          ...annotation,
          id,
          createdAt: annotation.createdAt || now,
          modifiedAt: now,
        });
      });
      
      return newAnnotations;
    });
  };
  
  const getAnnotationsByLayer = (layerId: string) => {
    return Array.from(get(annotations).values()).filter(
      (annotation) => annotation.layerId === layerId
    );
  };
  
  const getVisibleAnnotations = () => {
    return Array.from(get(annotations).values()).filter(
      (annotation) => annotation.visible
    );
  };
  
  const getSelectedAnnotations = () => {
    const currentAnnotations = get(annotations);
    const currentSelectedIds = get(selectedAnnotationIds);
    return Array.from(currentSelectedIds)
      .map(id => currentAnnotations.get(id))
      .filter((a): a is Annotation => a !== undefined);
  };
  
  // Utility functions
  const duplicateAnnotation = (id: string, offset = { x: 10, y: 10, z: 0 }) => {
    const annotation = get(annotations).get(id);
    if (!annotation) return null;
    
    const duplicated = {
      ...annotation,
      worldCoord: {
        x: annotation.worldCoord.x + offset.x,
        y: annotation.worldCoord.y + offset.y,
        z: annotation.worldCoord.z + offset.z,
      },
    };
    
    // Handle special cases for different annotation types
    if (duplicated.type === 'line' && 'endCoord' in duplicated) {
      duplicated.endCoord = {
        x: duplicated.endCoord.x + offset.x,
        y: duplicated.endCoord.y + offset.y,
        z: duplicated.endCoord.z + offset.z,
      };
    }
    
    // Remove id and timestamps - they'll be regenerated
    const { id: _, createdAt: __, modifiedAt: ___, ...annotationData } = duplicated;
    
    return addAnnotation(annotationData);
  };
  
  const lockAnnotation = (id: string, locked: boolean) => {
    updateAnnotation(id, { locked });
  };

  // Get current state (for zustand compatibility)
  const getState = () => ({
    annotations: get(annotations),
    groups: get(groups),
    selectedAnnotationIds: get(selectedAnnotationIds),
    hoveredAnnotationId: get(hoveredAnnotationId),
    activeToolMode: get(activeToolMode)
  });

  // Return the store interface
  return {
    // Expose readable stores
    annotations: { subscribe: annotations.subscribe },
    groups: { subscribe: groups.subscribe },
    selectedAnnotationIds: { subscribe: selectedAnnotationIds.subscribe },
    hoveredAnnotationId: { subscribe: hoveredAnnotationId.subscribe },
    activeToolMode: { subscribe: activeToolMode.subscribe },
    visibleAnnotations,
    selectedAnnotations,
    
    // Expose all methods
    addAnnotation,
    updateAnnotation,
    removeAnnotation,
    removeAnnotations,
    clearAnnotations,
    selectAnnotation,
    deselectAnnotation,
    selectAnnotations,
    clearSelection,
    selectAll,
    toggleVisibility,
    setVisibility,
    showAll,
    hideAll,
    createGroup,
    addToGroup,
    removeFromGroup,
    deleteGroup,
    toggleGroupVisibility,
    setHoveredAnnotation,
    setActiveToolMode,
    importAnnotations,
    getAnnotationsByLayer,
    getVisibleAnnotations,
    getSelectedAnnotations,
    duplicateAnnotation,
    lockAnnotation,
    getState
  };
}

// Create and export the store
export const annotationStore = createAnnotationStore();

// Export typed hooks for Svelte components
export const useAnnotationStore = () => annotationStore;