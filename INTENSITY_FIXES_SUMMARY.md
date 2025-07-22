# Intensity Slider Fix Summary

## Problem
Intensity slider values were snapping back to 20-80% defaults (1969.6-7878.4 for data range 0-9848) whenever the user interacted with other controls or when certain events fired.

## Root Causes Identified

1. **StoreSyncService was re-processing layer.added events** and overwriting user values with defaults
2. **No protection against duplicate events** causing layers to be re-initialized
3. **ViewState subscription feedback loop** where changes were being re-applied
4. **Dirty flag not checked everywhere** allowing stale values to overwrite user changes

## Fixes Implemented

### 1. Comprehensive Logging
- Added stack trace logging when 20-80% values are detected
- Added duplicate event detection and logging
- Enhanced ViewState update logging to track all changes

### 2. Dirty Flag Protection
- Added `dirtyLayers` Set to track layers with user modifications
- Added `layerVersions` Map to track update versions
- LayerPanel marks layers as dirty when user makes changes
- StoreSyncService checks dirty flag before updating layers

### 3. Duplicate Layer Prevention
- Added check in layer.added handler to prevent overwriting existing layers in ViewState
- Returns early if layer already exists instead of adding duplicate
- Logs critical error if duplicate addition is attempted

### 4. Priority-Based Intensity Resolution
- First priority: Preserve existing ViewState values for dirty layers
- Second priority: Preserve any existing ViewState values
- Third priority: Use layerRender values from store
- Last resort: Use data range defaults

### 5. ViewState Subscription Protection
- Skip updates for dirty layers in ViewState subscription
- Skip updates if values already match
- Added logging to track subscription behavior

### 6. Event Handler Improvements
- layer.patched event no longer clears dirty flag immediately
- Removed layer.metadata.updated handler that was causing resets
- Added protection against processing stale events

## Testing Instructions

1. Run the app with `cargo tauri dev`
2. Load a volume file
3. Change the intensity slider to various values (including 0% and 100%)
4. Interact with other controls (crosshair, opacity, colormap)
5. Verify intensity values don't snap back to 20-80%

## Console Logs to Monitor

- `[StoreSyncService] ❌ CRITICAL: About to overwrite existing layer` - Should NOT appear
- `[StoreSyncService] ⚠️ DUPLICATE layer.added event` - Should NOT appear
- `[StoreSyncService] Marked layer XXX as dirty` - Should appear when sliders change
- `[StoreSyncService] Layer XXX is dirty, preserving existing ViewState values` - Should appear
- Backend logs should show user's intensity values, not 1969.6-7878.4

## Remaining Considerations

If the issue persists, check:
1. Whether layer.added is being fired multiple times
2. If there's another code path updating ViewState we haven't found
3. If the coalescing middleware is somehow reverting values
4. If metadata updates are triggering unexpected re-syncs