/**
 * Zustand store for managing annotations across all views
 *
 * This store maintains the global state of all annotations and provides
 * methods for CRUD operations, selection, and bulk updates.
 */

import { createStore, type StateCreator } from '$lib/zustand-vanilla';
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

export interface AnnotationStore {
	// State
	annotations: Map<string, Annotation>;
	groups: Map<string, AnnotationGroup>;
	selectedAnnotationIds: Set<string>;
	hoveredAnnotationId: string | null;
	activeToolMode: 'select' | 'text' | 'marker' | 'line' | 'roi' | 'measure' | null;

	// Annotation CRUD operations
	addAnnotation: (annotation: Annotation) => void;
	updateAnnotation: (id: string, updates: Partial<Annotation>) => void;
	removeAnnotation: (id: string) => void;
	removeAnnotations: (ids: string[]) => void;
	clearAnnotations: () => void;

	// Selection operations
	selectAnnotation: (id: string, multi?: boolean) => void;
	deselectAnnotation: (id: string) => void;
	selectAnnotations: (ids: string[]) => void;
	clearSelection: () => void;
	selectAll: () => void;

	// Visibility operations
	toggleVisibility: (id: string) => void;
	setVisibility: (id: string, visible: boolean) => void;
	showAll: () => void;
	hideAll: () => void;

	// Group operations
	createGroup: (group: AnnotationGroup) => void;
	addToGroup: (groupId: string, annotationIds: string[]) => void;
	removeFromGroup: (groupId: string, annotationIds: string[]) => void;
	deleteGroup: (groupId: string) => void;
	toggleGroupVisibility: (groupId: string) => void;

	// Hover state
	setHoveredAnnotation: (id: string | null) => void;

	// Tool mode
	setActiveToolMode: (mode: AnnotationStore['activeToolMode']) => void;

	// Bulk operations
	importAnnotations: (annotations: Annotation[], replace?: boolean) => void;
	getAnnotationsByLayer: (layerId: string) => Annotation[];
	getVisibleAnnotations: () => Annotation[];
	getSelectedAnnotations: () => Annotation[];

	// Utility functions
	duplicateAnnotation: (id: string, duplicatedAnnotation: Annotation) => void;
	lockAnnotation: (id: string, locked: boolean) => void;
}

const createAnnotationStore: StateCreator<AnnotationStore> = (set, get) => ({
	// Initial state
	annotations: new Map(),
	groups: new Map(),
	selectedAnnotationIds: new Set(),
	hoveredAnnotationId: null,
	activeToolMode: null,

	// Add annotation
	addAnnotation: (annotation: Annotation) => {
		set((state) => {
			const newAnnotations = new Map(state.annotations);
			newAnnotations.set(annotation.id, annotation);
			return { annotations: newAnnotations };
		});
	},

	// Update annotation
	updateAnnotation: (id, updates) => {
		set((state) => {
			const annotation = state.annotations.get(id);
			if (!annotation) return state;

			const newAnnotations = new Map(state.annotations);
			newAnnotations.set(id, {
				...annotation,
				...updates
			});

			return { annotations: newAnnotations };
		});
	},

	// Remove annotation
	removeAnnotation: (id) => {
		set((state) => {
			const annotation = state.annotations.get(id);
			if (!annotation) return state;

			const newAnnotations = new Map(state.annotations);
			newAnnotations.delete(id);

			const newSelectedIds = new Set(state.selectedAnnotationIds);
			newSelectedIds.delete(id);

			// Remove from groups
			const newGroups = new Map(state.groups);
			newGroups.forEach((group) => {
				const index = group.annotationIds.indexOf(id);
				if (index !== -1) {
					group.annotationIds.splice(index, 1);
				}
			});

			return {
				annotations: newAnnotations,
				selectedAnnotationIds: newSelectedIds,
				groups: newGroups,
				hoveredAnnotationId: state.hoveredAnnotationId === id ? null : state.hoveredAnnotationId
			};
		});
	},

	// Remove multiple annotations
	removeAnnotations: (ids) => {
		set((state) => {
			const newAnnotations = new Map(state.annotations);
			const newSelectedIds = new Set(state.selectedAnnotationIds);
			const newGroups = new Map(state.groups);
			
			ids.forEach(id => {
				if (newAnnotations.has(id)) {
					newAnnotations.delete(id);
					newSelectedIds.delete(id);
					
					// Remove from groups
					newGroups.forEach((group) => {
						const index = group.annotationIds.indexOf(id);
						if (index !== -1) {
							group.annotationIds.splice(index, 1);
						}
					});
				}
			});

			return {
				annotations: newAnnotations,
				selectedAnnotationIds: newSelectedIds,
				groups: newGroups,
				hoveredAnnotationId: ids.includes(state.hoveredAnnotationId || '') ? null : state.hoveredAnnotationId
			};
		});
	},

	// Clear all annotations
	clearAnnotations: () => {
		set({
			annotations: new Map(),
			selectedAnnotationIds: new Set(),
			hoveredAnnotationId: null
		});
	},

	// Selection operations
	selectAnnotation: (id, multi = false) => {
		set((state) => {
			const annotation = state.annotations.get(id);
			if (!annotation) return state;

			const newSelectedIds = multi ? new Set(state.selectedAnnotationIds) : new Set<string>();

			newSelectedIds.add(id);
			return { selectedAnnotationIds: newSelectedIds };
		});
	},

	deselectAnnotation: (id) => {
		set((state) => {
			const newSelectedIds = new Set(state.selectedAnnotationIds);
			newSelectedIds.delete(id);
			return { selectedAnnotationIds: newSelectedIds };
		});
	},

	selectAnnotations: (ids) => {
		set({ selectedAnnotationIds: new Set(ids) });
	},

	clearSelection: () => {
		set({ selectedAnnotationIds: new Set() });
	},

	selectAll: () => {
		set((state) => ({
			selectedAnnotationIds: new Set(state.annotations.keys())
		}));
	},

	// Visibility operations
	toggleVisibility: (id) => {
		set((state) => {
			const annotation = state.annotations.get(id);
			if (!annotation) return state;

			const newAnnotations = new Map(state.annotations);
			newAnnotations.set(id, {
				...annotation,
				visible: !annotation.visible
			});

			return { annotations: newAnnotations };
		});
	},

	setVisibility: (id, visible) => {
		set((state) => {
			const annotation = state.annotations.get(id);
			if (!annotation) return state;

			const newAnnotations = new Map(state.annotations);
			newAnnotations.set(id, {
				...annotation,
				visible
			});

			return { annotations: newAnnotations };
		});
	},

	showAll: () => {
		set((state) => {
			const newAnnotations = new Map(state.annotations);
			newAnnotations.forEach((annotation) => {
				annotation.visible = true;
			});
			return { annotations: newAnnotations };
		});
	},

	hideAll: () => {
		set((state) => {
			const newAnnotations = new Map(state.annotations);
			newAnnotations.forEach((annotation) => {
				annotation.visible = false;
			});
			return { annotations: newAnnotations };
		});
	},

	// Group operations
	createGroup: (group: AnnotationGroup) => {
		set((state) => {
			const newGroups = new Map(state.groups);
			newGroups.set(group.id, group);
			return { groups: newGroups };
		});
	},

	addToGroup: (groupId, annotationIds) => {
		set((state) => {
			const group = state.groups.get(groupId);
			if (!group) return state;

			const newGroups = new Map(state.groups);
			const updatedGroup = {
				...group,
				annotationIds: [...new Set([...group.annotationIds, ...annotationIds])]
			};
			newGroups.set(groupId, updatedGroup);

			return { groups: newGroups };
		});
	},

	removeFromGroup: (groupId, annotationIds) => {
		set((state) => {
			const group = state.groups.get(groupId);
			if (!group) return state;

			const newGroups = new Map(state.groups);
			const updatedGroup = {
				...group,
				annotationIds: group.annotationIds.filter((id) => !annotationIds.includes(id))
			};
			newGroups.set(groupId, updatedGroup);

			return { groups: newGroups };
		});
	},

	deleteGroup: (groupId) => {
		set((state) => {
			const newGroups = new Map(state.groups);
			newGroups.delete(groupId);
			return { groups: newGroups };
		});
	},

	toggleGroupVisibility: (groupId) => {
		set((state) => {
			const group = state.groups.get(groupId);
			if (!group) return state;

			const newGroups = new Map(state.groups);
			const updatedGroup = { ...group, visible: !group.visible };
			newGroups.set(groupId, updatedGroup);

			// Update visibility of annotations in the group
			const newAnnotations = new Map(state.annotations);
			group.annotationIds.forEach((annotationId) => {
				const annotation = newAnnotations.get(annotationId);
				if (annotation) {
					annotation.visible = updatedGroup.visible;
				}
			});

			return { groups: newGroups, annotations: newAnnotations };
		});
	},

	// Hover state
	setHoveredAnnotation: (id) => {
		set({ hoveredAnnotationId: id });
	},

	// Tool mode
	setActiveToolMode: (mode) => {
		set({ activeToolMode: mode });
	},

	// Bulk operations
	importAnnotations: (annotations, replace = false) => {
		set((state) => {
			const newAnnotations = replace ? new Map() : new Map(state.annotations);

			annotations.forEach((annotation) => {
				newAnnotations.set(annotation.id, annotation);
			});

			return { annotations: newAnnotations };
		});
	},

	getAnnotationsByLayer: (layerId) => {
		return Array.from(get().annotations.values()).filter(
			(annotation) => annotation.layerId === layerId
		);
	},

	getVisibleAnnotations: () => {
		return Array.from(get().annotations.values()).filter((annotation) => annotation.visible);
	},

	getSelectedAnnotations: () => {
		const state = get();
		return Array.from(state.selectedAnnotationIds)
			.map((id) => state.annotations.get(id))
			.filter((a): a is Annotation => a !== undefined);
	},

	// Utility functions
	duplicateAnnotation: (id, duplicatedAnnotation) => {
		set((state) => {
			const newAnnotations = new Map(state.annotations);
			newAnnotations.set(duplicatedAnnotation.id, duplicatedAnnotation);
			return { annotations: newAnnotations };
		});
	},

	lockAnnotation: (id, locked) => {
		set((state) => {
			const annotation = state.annotations.get(id);
			if (!annotation) return state;

			const newAnnotations = new Map(state.annotations);
			newAnnotations.set(id, {
				...annotation,
				locked
			});

			return { annotations: newAnnotations };
		});
	}
});

// Create and export the store
export const annotationStore = createStore<AnnotationStore>(createAnnotationStore);

// Export typed hooks for Svelte components
export const useAnnotationStore = () => annotationStore;
