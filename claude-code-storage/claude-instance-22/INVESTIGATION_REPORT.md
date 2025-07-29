# Investigation Report: Crosshair Update Error in SliceViewRefactored

## Executive Summary

The crosshair update error occurs because `SliceViewRefactored` is calling `setCrosshair` with incorrect parameters. It passes an object `{ world_mm: worldCoord, visible: true }` instead of the expected array of coordinates.

## Error Details

**Error Message:**
```
TypeError: undefined is not a function (near '...[x, y, z]...')
    (anonymous function) (viewStateStore.ts:106)
```

**Note:** The error message references line 106, but the actual error occurs at line 170 in the current version of the file. The line numbers may have shifted due to code changes.

## Root Cause Analysis

### 1. Function Signature Mismatch

The `setCrosshair` function in `viewStateStore.ts` expects:
```typescript
setCrosshair: (world_mm: WorldCoordinates, updateViews?: boolean, immediate?: boolean) => Promise<void>;
```

Where `WorldCoordinates` is a tuple type `[number, number, number]`.

### 2. Incorrect Usage in SliceViewRefactored

**SliceViewRefactored.tsx (line 228) - INCORRECT:**
```typescript
setCrosshair({ world_mm: worldCoord, visible: true });
```

**SliceView.tsx (line 256) - CORRECT:**
```typescript
await setCrosshair(worldCoord, true);
```

### 3. Why the Error Occurs

In `viewStateStore.ts` at line 170, the function tries to destructure the position:
```typescript
const [x, y, z] = position;
```

When an object is passed instead of an array, JavaScript cannot destructure it as an array, causing the error.

## Additional Issues Found

1. **Missing await**: SliceViewRefactored doesn't await the setCrosshair promise, while the original SliceView does.

2. **Different parameters**: SliceViewRefactored tries to pass a `visible` property that doesn't exist in the function signature. The visibility is always set to true internally.

3. **Missing error handling**: The original SliceView has try-catch error handling around the setCrosshair call, which is missing in SliceViewRefactored.

## Recommended Fix

Replace the incorrect call in SliceViewRefactored.tsx (line 228):

```typescript
// FROM:
setCrosshair({ world_mm: worldCoord, visible: true });

// TO:
try {
  await setCrosshair(worldCoord, true);
  console.log(`[SliceViewRefactored ${viewId}] Crosshair updated successfully`);
} catch (error) {
  console.error(`[SliceViewRefactored ${viewId}] Failed to update crosshair:`, error);
}
```

This change:
- Passes the coordinates array directly as the first parameter
- Uses `true` for the `updateViews` parameter to update slice positions
- Adds proper error handling
- Awaits the promise to ensure proper execution order

## Impact

This bug prevents users from clicking in SliceViewRefactored to update the crosshair position, breaking a core navigation feature. The original SliceView component works correctly because it uses the proper function signature.