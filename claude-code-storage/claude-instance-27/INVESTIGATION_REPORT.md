# Investigation Report: Adding Crosshair Settings to FlexibleOrthogonalView

## Problem Statement
The previous attempt to add crosshair settings to FlexibleOrthogonalView by placing ViewToolbar inside the component broke the Allotment split pane layout. We need a solution that:
1. Provides access to crosshair settings
2. Doesn't interfere with the Allotment layout
3. Is consistent with the rest of the app's UI patterns

## Key Findings

### 1. FlexibleOrthogonalView Structure
- **Component**: `/ui2/src/components/views/FlexibleOrthogonalView.tsx`
- **Layout**: Uses Allotment (split pane) with nested vertical and horizontal splits
- **Structure**: 
  ```
  <div className="h-full w-full bg-gray-950 split-view-container">
    <Allotment vertical>
      <Allotment.Pane> → Axial view
      <Allotment.Pane>
        <Allotment horizontal>
          <Allotment.Pane> → Sagittal view
          <Allotment.Pane> → Coronal view
        </Allotment>
      </Allotment.Pane>
    </Allotment>
  </div>
  ```
- **Issue**: Allotment expects its direct children to be `Allotment.Pane` components. Adding any other element (like ViewToolbar) breaks this contract.

### 2. ViewToolbar Component
- **Component**: `/ui2/src/components/ui/ViewToolbar.tsx`
- **Features**: 
  - Contains CrosshairToggle and CrosshairSettingsPopover
  - Styled as a horizontal bar with `bg-[var(--app-bg-secondary)] border-b`
  - Designed to be placed at the top of a container

### 3. UI Patterns in the App

#### OrthogonalViewContainer Pattern
- **Component**: `/ui2/src/components/views/OrthogonalViewContainer.tsx`
- **Pattern**: Uses a floating toggle button with absolute positioning
  ```tsx
  <button className="absolute top-3 right-3 z-20 p-2 
                     bg-gray-800/60 hover:bg-gray-700/60 ...">
  ```
- **Advantages**: 
  - Doesn't interfere with layout
  - Minimal visual footprint
  - Clear hover states

#### MosaicViewPromise Pattern
- **Component**: `/ui2/src/components/views/MosaicViewPromise.tsx`
- **Pattern**: Uses a container div with toolbar as first child
  ```tsx
  <div className="mosaic-container">
    <MosaicToolbar ... />
    <div className="mosaic-grid flex-1 ...">
      {/* Grid content */}
    </div>
  </div>
  ```
- **CSS**: `mosaic-container` uses flexbox column layout
- **Key**: The toolbar is outside the grid structure

### 4. Crosshair UI Components
- **CrosshairToggle**: Button with keyboard shortcut (C key)
- **CrosshairSettingsPopover**: Popover with quick settings
- Both designed to work together in ViewToolbar

## Recommended Solutions

### Option 1: Floating Action Button (FAB) Pattern
**Implementation**: Add a floating button in the corner that opens crosshair settings
```tsx
<div className="h-full w-full bg-gray-950 split-view-container relative">
  {/* Floating crosshair button */}
  <div className="absolute top-3 right-3 z-20 flex gap-2">
    <CrosshairToggle className="bg-gray-800/60 hover:bg-gray-700/60" />
    <CrosshairSettingsPopover />
  </div>
  
  {/* Existing Allotment structure */}
  <Allotment vertical>
    ...
  </Allotment>
</div>
```
**Pros**: 
- Minimal code changes
- Doesn't interfere with Allotment
- Consistent with OrthogonalViewContainer pattern
- Always accessible

**Cons**:
- May overlap content
- Less discoverable than toolbar

### Option 2: Wrapper Container Pattern
**Implementation**: Wrap FlexibleOrthogonalView in a container that includes toolbar
```tsx
export function FlexibleOrthogonalViewWithToolbar({ workspaceId }) {
  return (
    <div className="flex flex-col h-full">
      <ViewToolbar showCrosshairControls={true} />
      <div className="flex-1 min-h-0">
        <FlexibleOrthogonalView workspaceId={workspaceId} />
      </div>
    </div>
  );
}
```
**Pros**:
- Clean separation of concerns
- Consistent with MosaicView pattern
- Full toolbar functionality
- No overlap issues

**Cons**:
- Requires new wrapper component
- Changes component hierarchy

### Option 3: Context Menu Pattern
**Implementation**: Right-click context menu on the view container
```tsx
const handleContextMenu = (e: React.MouseEvent) => {
  e.preventDefault();
  // Show context menu with crosshair options
};

<div 
  className="h-full w-full bg-gray-950 split-view-container"
  onContextMenu={handleContextMenu}
>
  ...
</div>
```
**Pros**:
- No visual clutter
- Doesn't affect layout
- Power user friendly

**Cons**:
- Less discoverable
- Requires custom context menu implementation

## Recommendation

**Option 1 (Floating Action Button)** is the recommended approach because:

1. **Minimal Impact**: Requires the least code changes and doesn't alter the component structure
2. **Consistency**: Matches the existing pattern in OrthogonalViewContainer
3. **Accessibility**: Always visible and accessible via keyboard shortcut
4. **Flexibility**: Can be positioned to minimize overlap (e.g., top-left instead of top-right)
5. **Progressive Enhancement**: Can start with just CrosshairToggle and add CrosshairSettingsPopover later

### Implementation Details for Option 1:
- Use similar styling to OrthogonalViewContainer's toggle button
- Position in top-left to avoid conflict with potential other controls
- Add subtle shadow for better visibility
- Include keyboard shortcut hint in tooltip
- Consider auto-hide on mouse inactivity (optional enhancement)

## Alternative Considerations

If Option 1 proves problematic due to overlapping content, Option 2 (Wrapper Container) would be the next best choice, as it provides the cleanest separation and follows established patterns in the codebase (MosaicView).