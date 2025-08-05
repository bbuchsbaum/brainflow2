/**
 * Migration utility to copy layerRender data from layerStore to viewStateStore
 * This ensures no data loss when removing the dual state pattern
 * 
 * NOTE: As of the architectural refactoring, layerRender has been removed from
 * layerStore and this migration is no longer needed. This file is kept for
 * historical purposes and to prevent errors in code that still calls it.
 */

import { useLayerStore } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';

/**
 * Migrate all layer render properties from layerStore to viewStateStore
 * @returns true if migration was performed, false if already migrated
 */
export function migrateLayerRenderToViewState(): boolean {
  // Migration is no longer needed as layerRender has been removed from layerStore
  // and ViewState is now the single source of truth for render properties
  console.log('[Migration] layerRender has been removed from layerStore - no migration needed');
  
  // Mark migration as complete if not already marked
  if (typeof window !== 'undefined' && !isMigrationComplete()) {
    window.localStorage.setItem('layerRenderMigrated', 'true');
  }
  
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