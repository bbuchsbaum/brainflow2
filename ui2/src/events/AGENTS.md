<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-10 -->

# ui2/src/events

## Purpose
Custom event handling system for decoupled inter-component communication. Provides EventBus for global event pub/sub and RenderEventChannel for render-specific events. Used for events that cross component boundaries or React tree isolation (GoldenLayout panels).

## Key Files
| File | Description |
|------|-------------|
| EventBus.ts | Global event bus with typed events, subscriptions, and debugging - 9KB |
| RenderEventChannel.ts | Specialized channel for render completion events - 1KB |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| __tests__/ | Event system tests |

## For AI Agents

### Working In This Directory
- EventBus is for events that cross component boundaries
- Use Zustand for state, EventBus for notifications/signals
- Events should be typed using TypeScript
- Clean up subscriptions in component cleanup
- Document event payloads and contracts
- Use namespaced event names (e.g., 'render.complete', 'layer.loaded')
- RenderEventChannel is specifically for render events
- EventBus supports both global and scoped subscriptions

### Testing Requirements
- Test event emission and receipt
- Test subscription cleanup
- Test multiple subscribers
- Test event payload types
- Test scoped subscriptions
- Verify no memory leaks from lingering subscriptions
- Mock EventBus for component tests

### Common Patterns
- Subscribe: `const unsubscribe = EventBus.on('event.name', handler)`
- Emit: `EventBus.emit('event.name', payload)`
- Cleanup: `return () => unsubscribe()` in useEffect
- Typed events: Define payload types in types/renderEvents.ts
- Scoped events: Use tag or viewType for filtering
- Once: `EventBus.once('event.name', handler)` for one-time handlers
- Debug: `EventBus.setDebug(true)` for event logging

## Dependencies

### Internal
- ../types/renderEvents.ts - Event type definitions

### External
- None

<!-- MANUAL: Critical for render events. Respect the tag/viewType filtering for SliceView vs MosaicView isolation. -->
