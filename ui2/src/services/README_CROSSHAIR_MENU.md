# Crosshair Menu Implementation

## Current State

We've removed all in-view crosshair controls (toolbars, floating buttons) from the brain viewers to maximize viewing area and provide a cleaner interface.

## Implementation Plan

### Frontend (Completed)

1. **Removed all in-view controls**:
   - Removed ViewToolbar from FlexibleOrthogonalView
   - Removed unused ViewToolbar import from OrthogonalViewContainer
   - Views now have clean, unobstructed display areas

2. **Created CrosshairMenuService**:
   - Listens for `crosshair-action` events from Tauri menu
   - Handles `toggle` action to show/hide crosshairs
   - Handles `open-settings` action (placeholder for future settings window)
   - Integrated with CrosshairContext via useCrosshairSettings hook

### Backend/Tauri (Pending)

The Tauri menu needs to be updated in `src-tauri/src/main.rs` to add:

```rust
// In the View menu, after fullscreen:
.item(&MenuItemBuilder::new("Show Crosshair")
    .id("toggle_crosshair")
    .accelerator("C")
    .build(app)?)
.item(&MenuItemBuilder::new("Crosshair Settings...")
    .id("crosshair_settings")
    .build(app)?)
```

And in the menu event handler:

```rust
"toggle_crosshair" => {
    app.emit("crosshair-action", json!({"action": "toggle"}))
}
"crosshair_settings" => {
    app.emit("crosshair-action", json!({"action": "open-settings"}))
}
```

## Benefits

- **Clean UI**: No visual clutter in brain viewers
- **Consistent**: Same menu access across all view types
- **Professional**: Follows standard desktop application patterns
- **Keyboard Support**: C key still toggles crosshairs

## Future Work

1. Implement proper Tauri settings window for crosshair options
2. Add persistence of crosshair settings
3. Consider adding more appearance settings to the menu