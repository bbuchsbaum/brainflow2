# Layer Metadata Popover Styling Investigation Report

## Overview
The Layer metadata popover appears when clicking the "info" button on layer rows in the Layer panel. The issue is that the popover lacks proper margins and has poor styling, appearing too close to the trigger button and edges.

## Component Hierarchy

### 1. Layer Panel (`/ui2/src/components/panels/LayerPanel.tsx`)
- Main container for the layer management interface
- Contains the `LayerTable` component at line 184
- Handles layer selection, visibility toggles, and metadata display

### 2. Layer Table (`/ui2/src/components/ui/LayerTable.tsx`)
- Displays the list of layers with visibility toggles and info buttons
- Info button implementation at lines 139-151:
  ```tsx
  <MetadataPopover layerId={layer.id}>
    <button
      className="icon-btn opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
      onClick={(e) => {
        e.stopPropagation();
      }}
      aria-label={`Metadata for ${layer.name}`}
      tabIndex={-1}
    >
      <Info className="h-4 w-4" />
    </button>
  </MetadataPopover>
  ```

### 3. Metadata Popover (`/ui2/src/components/ui/MetadataPopover.tsx`)
- Main popover component showing layer metadata
- Uses Radix UI's Popover primitive wrapped by shadcn components
- Current implementation (lines 65-86):
  ```tsx
  <PopoverContent 
    side="right" 
    align="center"
    className={cn(
      "max-w-[18rem]",
      "rounded-lg",
      "border border-gray-700/40",
      "bg-gray-900 text-gray-100",
      "shadow-xl shadow-black/20",
      // animations...
    )}
    style={{ backgroundColor: 'rgba(17, 24, 39, 0.95)' }}
    sideOffset={8}
  >
  ```

## Styling Issues Identified

### 1. Padding Problem
The `PopoverContent` component from shadcn has default padding (`p-4`), but the MetadataPopover overrides this with a wrapper div that has `p-6`. This creates a conflict where Radix UI's `all: unset` might be removing the padding.

### 2. Missing Margins
The popover has `sideOffset={8}` which provides only 8px spacing from the trigger button. This is insufficient for good visual separation.

### 3. Inconsistent Styling with Theme
The popover uses hard-coded colors instead of CSS variables from the theme system:
- Hard-coded: `bg-gray-900 text-gray-100`
- Should use: `bg-popover text-popover-foreground`

### 4. Shadcn Popover Base Styles
The base popover component (`/ui2/src/components/ui/shadcn/popover.tsx`) has default classes that might be getting overridden:
```tsx
className={cn(
  "z-50 w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none...",
  className
)}
```

## Existing Styling Patterns

### 1. Modal Component (`/ui2/src/components/ui/Modal.tsx`)
- Uses proper padding: `p-4` for content
- Has clear structure with header and content areas
- Uses responsive spacing

### 2. Sheet/Drawer Components
- MetadataDrawer uses the Sheet component with `p-6` padding
- Has proper spacing and margins
- Uses theme variables correctly

### 3. Theme Variables (from `/ui2/src/styles/shadcn.css`)
```css
--popover: 220 17% 9%;           /* gray-900 #0f172a */
--popover-foreground: 220 9% 90%; /* gray-200 #e2e8f0 */
```

## Edge Cases & Considerations

### 1. Viewport Boundaries
- Popover appears on the right side of the info button
- Need to ensure it doesn't overflow viewport on smaller screens
- Should consider using `collisionPadding` prop

### 2. Content Overflow
- Long metadata values might overflow
- Copy buttons need proper spacing

### 3. Animation Conflicts
- Multiple animation classes might conflict
- Radix UI's built-in animations vs custom Tailwind animations

### 4. Z-index Stacking
- Popover needs proper z-index to appear above other UI elements
- Current `z-50` should be sufficient

## Recommended Fixes

### 1. Fix Padding Structure
Remove the wrapper div and apply padding directly to the PopoverContent:
```tsx
<PopoverContent className={cn("p-6", ...otherClasses)}>
  {/* Remove wrapper div, content goes here directly */}
</PopoverContent>
```

### 2. Increase Side Offset
Change from `sideOffset={8}` to `sideOffset={12}` or `sideOffset={16}` for better spacing.

### 3. Use Theme Variables
Replace hard-coded colors with theme variables:
```tsx
className={cn(
  "bg-popover text-popover-foreground",
  "border border-border",
  ...
)}
```

### 4. Add Collision Padding
Add `collisionPadding={10}` to prevent viewport overflow:
```tsx
<PopoverContent 
  collisionPadding={10}
  sideOffset={12}
  ...
>
```

### 5. Consistent Border Radius
Use theme variable for border radius:
```tsx
"rounded-[var(--radius)]" // instead of "rounded-lg"
```

## File Locations Summary
- **Layer Panel**: `/ui2/src/components/panels/LayerPanel.tsx`
- **Layer Table**: `/ui2/src/components/ui/LayerTable.tsx`
- **Metadata Popover**: `/ui2/src/components/ui/MetadataPopover.tsx`
- **Shadcn Popover**: `/ui2/src/components/ui/shadcn/popover.tsx`
- **Theme CSS**: `/ui2/src/styles/shadcn.css`
- **Tailwind Config**: `/ui2/tailwind.config.js`