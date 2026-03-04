<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-10 -->

# ui2/src/utils

## Purpose
Utility functions for common operations including coordinate transformations, canvas operations, rendering debug, validation, and helper functions. Provides pure, reusable functions with no side effects. Critical utilities for coordinate system handling and aspect ratio preservation.

## Key Files
| File | Description |
|------|-------------|
| coordinates.ts | Create orthogonal views with uniform pixel size (square pixels) - 6KB |
| coordinateTransform.ts | Coordinate system transformations - 3KB |
| crosshairUtils.ts | Crosshair calculation and utilities - 4KB |
| canvasUtils.ts | Canvas operations and image handling - 3KB |
| mosaicUtils.ts | Mosaic grid layout calculations - 3KB |
| dimensions.ts | Dimension calculations and utilities - 1KB |
| renderDebug.ts | Render debugging utilities - 7KB |
| validateRenderViewPayload.ts | Validate render view payloads - 6KB |
| formatTauriError.ts | Format Tauri errors for user display - 0.6KB |
| migrateLayerRenderToViewState.ts | Migration utility for layerRender → ViewState - 1KB |
| debounce.ts | Debounce function implementation - 0.4KB |
| devAssert.ts | Development assertions - 0.5KB |
| eventUtils.ts | Event handling utilities - 2KB |
| withTimeout.ts | Timeout wrapper for promises - 0.6KB |
| cn.ts | Tailwind className utility - 0.3KB |
| coordinates.test.ts | Coordinate utility tests - 5KB |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| __tests__/ | Utility function tests |

## For AI Agents

### Working In This Directory
- Utils are pure functions - no side effects
- No store access or service calls in utils
- Utils should be small, focused, and testable
- Use TypeScript for strict typing
- Document complex algorithms
- Add JSDoc comments for public functions
- Write unit tests for all utilities
- Keep coordinate math accurate
- CRITICAL: Use uniform pixel size (Math.max) for aspect ratio preservation

### Testing Requirements
- Unit test every utility function
- Test edge cases and boundary conditions
- Test coordinate transformations with known values
- Test error cases
- Use property-based testing for math functions
- Verify no side effects
- Test performance for hot paths

### Common Patterns
- Pure functions: `(input) => output` with no side effects
- Coordinate transforms: Handle LPI world space correctly
- Pixel size: `Math.max(widthMm / dimX, heightMm / dimY)` for uniform (square) pixels
- Error handling: Return Result types or throw with clear messages
- Type guards: `isType(value): value is Type`
- Validation: Return boolean or throw with details
- Memoization: Cache expensive calculations
- Array operations: Use map/filter/reduce

## Dependencies

### Internal
- ../types/ - Type definitions

### External
- None (pure utilities)

<!-- MANUAL: CRITICAL - Always use uniform pixel size in coordinates.ts to preserve aspect ratio! -->
