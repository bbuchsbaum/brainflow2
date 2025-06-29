/**
 * AnnotationService - Manages annotations across the application
 * 
 * This service handles all annotation operations including CRUD,
 * selection, visibility, grouping, and persistence.
 */

import type { EventBus } from '$lib/events/EventBus';
import type { ConfigService } from './ConfigService';
import type { NotificationService } from './NotificationService';
import { annotationStore } from '$lib/stores/annotationStore';
import type { 
  Annotation, 
  AnnotationGroup,
  Vec3 
} from '$lib/types/annotations';
import { nanoid } from 'nanoid';

export interface AnnotationServiceConfig {
  eventBus: EventBus;
  configService: ConfigService;
  notificationService: NotificationService;
}

export class AnnotationService {
  private config: AnnotationServiceConfig;
  private autoSaveTimer: number | null = null;
  private isDirty = false;

  constructor(config: AnnotationServiceConfig) {
    this.config = config;
    this.initializeEventHandlers();
    this.setupAutoSave();
  }

  private initializeEventHandlers(): void {
    const { eventBus } = this.config;

    // Listen for layer removal to clean up orphaned annotations
    eventBus.on('layer.removed', ({ layerId }) => {
      this.removeAnnotationsByLayer(layerId);
    });

    // Listen for save requests
    eventBus.on('annotations.save.requested', () => {
      this.saveAnnotations();
    });

    // Listen for load requests
    eventBus.on('annotations.load.requested', ({ path }) => {
      this.loadAnnotationsFromFile(path);
    });

    // Listen for export requests
    eventBus.on('annotations.export.requested', ({ format }) => {
      this.exportAnnotations(format);
    });
  }

  private setupAutoSave(): void {
    const autoSaveInterval = this.config.configService.get('annotations.autoSaveInterval', 30000); // 30 seconds default
    
    if (autoSaveInterval > 0) {
      this.autoSaveTimer = window.setInterval(() => {
        if (this.isDirty) {
          this.saveAnnotations();
        }
      }, autoSaveInterval);
    }
  }

  private markDirty(): void {
    this.isDirty = true;
    this.config.eventBus.emit('annotations.dirty', { isDirty: true });
  }

  private markClean(): void {
    this.isDirty = false;
    this.config.eventBus.emit('annotations.dirty', { isDirty: false });
  }

  // CRUD Operations

  async addAnnotation(annotation: Omit<Annotation, 'id' | 'createdAt' | 'modifiedAt'>): Promise<string> {
    try {
      const id = annotationStore.getState().addAnnotation(annotation);
      
      this.config.eventBus.emit('annotation.added', { 
        annotationId: id,
        annotation: annotationStore.getState().annotations.get(id)!
      });
      
      this.markDirty();
      return id;
    } catch (error) {
      console.error('[AnnotationService] Failed to add annotation:', error);
      this.config.notificationService.error('Failed to add annotation');
      throw error;
    }
  }

  async updateAnnotation(id: string, updates: Partial<Annotation>): Promise<void> {
    try {
      const annotation = annotationStore.getState().annotations.get(id);
      if (!annotation) {
        throw new Error(`Annotation ${id} not found`);
      }

      if (annotation.locked) {
        this.config.notificationService.warning('Cannot update locked annotation');
        return;
      }

      annotationStore.getState().updateAnnotation(id, updates);
      
      this.config.eventBus.emit('annotation.updated', { 
        annotationId: id,
        updates 
      });
      
      this.markDirty();
    } catch (error) {
      console.error('[AnnotationService] Failed to update annotation:', error);
      this.config.notificationService.error('Failed to update annotation');
      throw error;
    }
  }

  async removeAnnotation(id: string): Promise<void> {
    try {
      const annotation = annotationStore.getState().annotations.get(id);
      if (!annotation) {
        throw new Error(`Annotation ${id} not found`);
      }

      if (annotation.locked) {
        this.config.notificationService.warning('Cannot remove locked annotation');
        return;
      }

      annotationStore.getState().removeAnnotation(id);
      
      this.config.eventBus.emit('annotation.removed', { 
        annotationId: id 
      });
      
      this.markDirty();
    } catch (error) {
      console.error('[AnnotationService] Failed to remove annotation:', error);
      this.config.notificationService.error('Failed to remove annotation');
      throw error;
    }
  }

  async removeAnnotations(ids: string[]): Promise<void> {
    const lockedCount = ids.filter(id => {
      const annotation = annotationStore.getState().annotations.get(id);
      return annotation?.locked;
    }).length;

    if (lockedCount > 0) {
      this.config.notificationService.warning(`Skipped ${lockedCount} locked annotations`);
    }

    annotationStore.getState().removeAnnotations(ids);
    
    this.config.eventBus.emit('annotations.removed', { 
      annotationIds: ids 
    });
    
    this.markDirty();
  }

  async clearAnnotations(): Promise<void> {
    const confirmed = await this.config.notificationService.confirm(
      'Clear all annotations?',
      'This action cannot be undone.'
    );

    if (!confirmed) return;

    annotationStore.getState().clearAnnotations();
    
    this.config.eventBus.emit('annotations.cleared');
    
    this.markDirty();
  }

  // Selection Operations

  selectAnnotation(id: string, multi = false): void {
    annotationStore.getState().selectAnnotation(id, multi);
    
    this.config.eventBus.emit('annotation.selected', { 
      annotationId: id,
      multi 
    });
  }

  deselectAnnotation(id: string): void {
    annotationStore.getState().deselectAnnotation(id);
    
    this.config.eventBus.emit('annotation.deselected', { 
      annotationId: id 
    });
  }

  selectAnnotations(ids: string[]): void {
    annotationStore.getState().selectAnnotations(ids);
    
    this.config.eventBus.emit('annotations.selected', { 
      annotationIds: ids 
    });
  }

  clearSelection(): void {
    annotationStore.getState().clearSelection();
    
    this.config.eventBus.emit('annotations.selection.cleared');
  }

  selectAll(): void {
    annotationStore.getState().selectAll();
    
    this.config.eventBus.emit('annotations.selection.all');
  }

  // Visibility Operations

  toggleVisibility(id: string): void {
    annotationStore.getState().toggleVisibility(id);
    
    const annotation = annotationStore.getState().annotations.get(id);
    if (annotation) {
      this.config.eventBus.emit('annotation.visibility.changed', { 
        annotationId: id,
        visible: annotation.visible 
      });
    }
    
    this.markDirty();
  }

  setVisibility(id: string, visible: boolean): void {
    annotationStore.getState().setVisibility(id, visible);
    
    this.config.eventBus.emit('annotation.visibility.changed', { 
      annotationId: id,
      visible 
    });
    
    this.markDirty();
  }

  showAll(): void {
    annotationStore.getState().showAll();
    
    this.config.eventBus.emit('annotations.visibility.all', { 
      visible: true 
    });
    
    this.markDirty();
  }

  hideAll(): void {
    annotationStore.getState().hideAll();
    
    this.config.eventBus.emit('annotations.visibility.all', { 
      visible: false 
    });
    
    this.markDirty();
  }

  // Group Operations

  createGroup(name: string, annotationIds: string[] = []): string {
    const id = annotationStore.getState().createGroup(name, annotationIds);
    
    this.config.eventBus.emit('annotation.group.created', { 
      groupId: id,
      name,
      annotationIds 
    });
    
    this.markDirty();
    return id;
  }

  addToGroup(groupId: string, annotationIds: string[]): void {
    annotationStore.getState().addToGroup(groupId, annotationIds);
    
    this.config.eventBus.emit('annotation.group.updated', { 
      groupId,
      added: annotationIds 
    });
    
    this.markDirty();
  }

  removeFromGroup(groupId: string, annotationIds: string[]): void {
    annotationStore.getState().removeFromGroup(groupId, annotationIds);
    
    this.config.eventBus.emit('annotation.group.updated', { 
      groupId,
      removed: annotationIds 
    });
    
    this.markDirty();
  }

  deleteGroup(groupId: string): void {
    annotationStore.getState().deleteGroup(groupId);
    
    this.config.eventBus.emit('annotation.group.deleted', { 
      groupId 
    });
    
    this.markDirty();
  }

  // Utility Operations

  setHoveredAnnotation(id: string | null): void {
    annotationStore.getState().setHoveredAnnotation(id);
    
    this.config.eventBus.emit('annotation.hover.changed', { 
      annotationId: id 
    });
  }

  setActiveToolMode(mode: 'select' | 'text' | 'marker' | 'line' | 'roi' | 'measure' | null): void {
    annotationStore.getState().setActiveToolMode(mode);
    
    this.config.eventBus.emit('annotation.tool.changed', { 
      tool: mode 
    });
  }

  duplicateAnnotation(id: string, offset?: Vec3): string | null {
    const newId = annotationStore.getState().duplicateAnnotation(id, offset);
    
    if (newId) {
      this.config.eventBus.emit('annotation.duplicated', { 
        originalId: id,
        newId 
      });
      
      this.markDirty();
    }
    
    return newId;
  }

  lockAnnotation(id: string, locked: boolean): void {
    annotationStore.getState().lockAnnotation(id, locked);
    
    this.config.eventBus.emit('annotation.lock.changed', { 
      annotationId: id,
      locked 
    });
    
    this.markDirty();
  }

  // Query Operations

  getAnnotationsByLayer(layerId: string): Annotation[] {
    return annotationStore.getState().getAnnotationsByLayer(layerId);
  }

  getVisibleAnnotations(): Annotation[] {
    return annotationStore.getState().getVisibleAnnotations();
  }

  getSelectedAnnotations(): Annotation[] {
    return annotationStore.getState().getSelectedAnnotations();
  }

  getAnnotation(id: string): Annotation | undefined {
    return annotationStore.getState().annotations.get(id);
  }

  // Persistence Operations

  private async saveAnnotations(): Promise<void> {
    try {
      const state = annotationStore.getState();
      const data = {
        annotations: Array.from(state.annotations.values()),
        groups: Array.from(state.groups.values()),
        version: '1.0.0'
      };

      // For now, save to localStorage
      // TODO: Implement proper file saving through Tauri
      localStorage.setItem('brainflow_annotations', JSON.stringify(data));
      
      this.markClean();
      this.config.notificationService.success('Annotations saved');
      
      this.config.eventBus.emit('annotations.saved');
    } catch (error) {
      console.error('[AnnotationService] Failed to save annotations:', error);
      this.config.notificationService.error('Failed to save annotations');
      throw error;
    }
  }

  private async loadAnnotationsFromFile(path: string): Promise<void> {
    try {
      // TODO: Implement proper file loading through Tauri
      // For now, load from localStorage
      const dataStr = localStorage.getItem('brainflow_annotations');
      if (!dataStr) {
        this.config.notificationService.info('No saved annotations found');
        return;
      }

      const data = JSON.parse(dataStr);
      annotationStore.getState().importAnnotations(data.annotations, true);
      
      // Restore groups
      if (data.groups) {
        data.groups.forEach((group: AnnotationGroup) => {
          annotationStore.getState().createGroup(group.name, group.annotationIds);
        });
      }
      
      this.markClean();
      this.config.notificationService.success('Annotations loaded');
      
      this.config.eventBus.emit('annotations.loaded', { path });
    } catch (error) {
      console.error('[AnnotationService] Failed to load annotations:', error);
      this.config.notificationService.error('Failed to load annotations');
      throw error;
    }
  }

  private async exportAnnotations(format: 'json' | 'csv' = 'json'): Promise<void> {
    try {
      const state = annotationStore.getState();
      const annotations = Array.from(state.annotations.values());

      let content: string;
      let filename: string;
      let mimeType: string;

      if (format === 'json') {
        content = JSON.stringify({
          annotations,
          groups: Array.from(state.groups.values()),
          exportDate: new Date().toISOString(),
          version: '1.0.0'
        }, null, 2);
        filename = 'annotations.json';
        mimeType = 'application/json';
      } else {
        // CSV export
        const headers = ['id', 'type', 'layerId', 'x', 'y', 'z', 'label', 'visible', 'locked'];
        const rows = annotations.map(a => [
          a.id,
          a.type,
          a.layerId,
          a.worldCoord.x,
          a.worldCoord.y,
          a.worldCoord.z,
          a.type === 'text' ? (a as any).text : '',
          a.visible,
          a.locked || false
        ]);
        
        content = [headers, ...rows].map(row => row.join(',')).join('\n');
        filename = 'annotations.csv';
        mimeType = 'text/csv';
      }

      // Create download
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);

      this.config.notificationService.success(`Annotations exported as ${format.toUpperCase()}`);
      
      this.config.eventBus.emit('annotations.exported', { format });
    } catch (error) {
      console.error('[AnnotationService] Failed to export annotations:', error);
      this.config.notificationService.error('Failed to export annotations');
      throw error;
    }
  }

  // Layer cleanup
  private removeAnnotationsByLayer(layerId: string): void {
    const annotations = this.getAnnotationsByLayer(layerId);
    const ids = annotations.map(a => a.id);
    
    if (ids.length > 0) {
      this.removeAnnotations(ids);
      this.config.notificationService.info(`Removed ${ids.length} annotations from removed layer`);
    }
  }

  // Cleanup
  dispose(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
    }

    // Save any pending changes
    if (this.isDirty) {
      this.saveAnnotations();
    }
  }
}