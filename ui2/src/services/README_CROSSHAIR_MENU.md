# Crosshair Menu Implementation

## Current State

We've removed all in-view crosshair controls (toolbars, floating buttons) from the brain viewers to maximize viewing area and provide a cleaner interface.

## Implementation Plan

### Frontend (Completed)

1. **Removed all in-view controls**:
   - Removed ViewToolbar from OrthogonalPanelsWorkspace
   - Removed unused ViewToolbar import from OrthogonalViewContainer
   - Views now have clean, unobstructed display areas

2. **Created CrosshairMenuService**:
   - Listens for `crosshair-action` events from Tauri menu
   - Handles `toggle` action to show/hide crosshairs
   - Handles `open-settings` action (placeholder for future settings window)
   - Integrated with CrosshairContext via useCrosshairSettings hook

### Backend/Tauri

`src-tauri/src/main.rs` builds View › Show Crosshair as a check item (id
`toggle_crosshair`, no accelerator: bare `C` is the UI's "go to image center")
and View › Crosshair Settings... (`crosshair_settings`). Both emit
`crosshair-action` (`toggle` / `open-settings`). The UI owns visibility:
`CrosshairMenuService` emits `crosshair-visibility-changed` `{ visible }` on
start and on every change, and the shell sets the check mark from it.

## Benefits

- **Clean UI**: No visual clutter in brain viewers
- **Consistent**: Same menu access across all view types
- **Professional**: Follows standard desktop application patterns
- **Keyboard Support**: C key still toggles crosshairs

## Future Work

1. Implement proper Tauri settings window for crosshair options
2. Add persistence of crosshair settings
3. Consider adding more appearance settings to the menu
