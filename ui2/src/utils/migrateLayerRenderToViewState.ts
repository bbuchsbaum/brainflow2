/**
 * Migration utility to copy layerRender data from layerStore to viewStateStore
 * This ensures no data loss when removing the dual state pattern
 */

import { useLayerStore } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';

/**
 * Migrate all layer render properties from layerStore to viewStateStore
 * @returns true if migration was performed, false if already migrated
 */
export function migrateLayerRenderToViewState(): boolean {
  console.log('[Migration] Starting layerRender to ViewState migration...');
  
  const layerStore = useLayerStore.getState();
  const viewStateStore = useViewStateStore.getState();
  
  // Check if we have any layerRender data to migrate
  if (layerStore.layerRender.size === 0) {
    console.log('[Migration] No layerRender data to migrate');
    return false;
  }
  
  // Get current viewState
  const currentViewState = viewStateStore.viewState;
  
  // Count how many layers need migration
  let migratedCount = 0;
  
  // Create updated layers array with migrated render properties
  const updatedLayers = currentViewState.layers.map(viewLayer => {
    const renderData = layerStore.layerRender.get(viewLayer.id);
    
    if (renderData) {
      migratedCount++;
      console.log(`[Migration] Migrating render data for layer ${viewLayer.id}:`, renderData);
      
      // Merge render properties into view layer
      return {
        ...viewLayer,
        opacity: renderData.opacity ?? viewLayer.opacity,
        intensity: renderData.intensity ?? viewLayer.intensity,
        threshold: renderData.threshold ?? viewLayer.threshold,
        colormap: renderData.colormap ?? viewLayer.colormap,
        // Note: interpolation is not in ViewLayer type, but exists in LayerRender
        // We'll preserve existing blend mode
      };
    }
    
    return viewLayer;
  });
  
  // Also check for any orphaned render data (layers in layerRender but not in viewState)
  const viewLayerIds = new Set(currentViewState.layers.map(l => l.id));
  const orphanedRenderIds: string[] = [];
  
  layerStore.layerRender.forEach((renderData, layerId) => {
    if (!viewLayerIds.has(layerId)) {
      orphanedRenderIds.push(layerId);
      console.warn(`[Migration] Found orphaned render data for layer ${layerId} - no corresponding ViewState layer`);
    }
  });
  
  if (migratedCount > 0) {
    // Update viewState with migrated data
    viewStateStore.setViewState(state => ({
      ...state,
      layers: updatedLayers
    }));
    
    console.log(`[Migration] Successfully migrated ${migratedCount} layer render properties`);
    
    if (orphanedRenderIds.length > 0) {
      console.log(`[Migration] Found ${orphanedRenderIds.length} orphaned render entries: ${orphanedRenderIds.join(', ')}`);
    }
    
    // Mark migration as complete by storing a flag
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('layerRenderMigrated', 'true');
    }
    
    return true;
  }
  
  console.log('[Migration] No layers needed migration');
  return false;
}

/**
 * Check if migration has already been performed
 */
export function isMigrationComplete(): boolean {
  if (typeof window !== 'undefined') {
    return window.localStorage.getItem('layerRenderMigrated') === 'true';
  }
  return false;
}

/**
 * Clear migration flag (useful for testing)
 */
export function clearMigrationFlag(): void {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem('layerRenderMigrated');
  }
}