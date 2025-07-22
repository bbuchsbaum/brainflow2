# StatusBar Refactoring Summary

## Overview
Refactored the StatusBar component from a monolithic component to a flexible, context-based architecture with fixed-width layout to prevent jitter.

## Changes Made

### 1. Created Type Definitions (`ui2/src/types/statusBar.ts`)
- `StatusSlot` type with id, label, value, width, and align properties
- Support for both string and ReactNode values
- Batch update types for performance

### 2. Implemented StatusContext (`ui2/src/contexts/StatusContext.tsx`)
- Global state management for status bar items
- Reducer-based updates with SET, BATCH, UPDATE_LABEL, UPDATE_WIDTH actions
- Custom hooks: useStatus, useStatusSlot, useSetStatus, useStatusUpdater
- Centralized control over all status bar data

### 3. Created Fixed-Width CSS (`ui2/src/components/ui/StatusBar.css`)
- Uses `font-variant-numeric: tabular-nums` for stable number display
- Fixed-width slots prevent layout jitter
- Monospace font for coordinate values
- Color-coded values by type (coordinates, fps, gpu status)
- Responsive design hides low-priority items on small screens

### 4. Refactored StatusBar Component (`ui2/src/components/ui/StatusBar.tsx`)
- Now a pure presentational component
- Reads data from StatusContext
- Renders slots dynamically based on state
- Supports filtering which slots to show
- Allows custom right-side content

### 5. Created Status Updates Hook (`ui2/src/hooks/useStatusBarUpdates.ts`)
- Connects data sources to StatusContext
- Subscribes to:
  - Crosshair position changes (from ViewStateStore)
  - Mouse coordinate events (from EventBus)
  - FPS updates (when available)
  - GPU status (when available)
  - Active layer information
- Formats coordinates for display

### 6. Updated App Component (`ui2/src/App.tsx`)
- Added StatusProvider wrapper with initial slots configuration
- Created AppContent component that uses status updates
- Defined initial status bar slots:
  - Coordinate System: LPI (18ch width)
  - Crosshair: (0.0, 0.0, 0.0) (24ch width)
  - Mouse: -- (24ch width)
  - Layer: None (20ch width)
  - FPS: -- (10ch width)
  - GPU: Ready (12ch width)

## Benefits

1. **No More Jitter**: Fixed-width slots and tabular numerals ensure stable layout
2. **Flexibility**: Easy to add/remove/reorder status items
3. **Performance**: Batch updates reduce re-renders
4. **Maintainability**: Clear separation of concerns
5. **Extensibility**: New status items just need to dispatch to context
6. **Testability**: Context can be mocked for testing

## Next Steps

1. Add more status items as needed (memory usage, render time, etc.)
2. Implement persistent user preferences for visible slots
3. Add click handlers for interactive status items
4. Consider adding status bar tooltips for detailed information

## Migration Notes

The SliceView component already emits the necessary mouse events, so no changes were needed there. The existing event bus integration works seamlessly with the new architecture.