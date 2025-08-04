# 4D Time Navigation Implementation Plan

**Plan Date:** 2025-08-01  
**Target System:** Brainflow2 4D Time Navigation  
**Priority Level:** HIGH - Production Critical  

## Executive Summary

This plan addresses **5 critical architectural issues** and **12 specific bugs** identified in the 4D time navigation system. The implementation follows a 4-phase approach designed to minimize risk while delivering immediate user experience improvements.

**Key Objectives:**
1. Fix critical UI bugs preventing proper time navigation
2. Eliminate architectural anti-patterns causing race conditions
3. Implement performance optimizations for smooth user experience
4. Establish clean separation of concerns for future maintainability

**Expected Timeline:** 2-3 weeks for complete implementation
**Risk Level:** LOW - Phased approach allows rollback at any stage

---

## Phase 1: Critical Bug Fixes (Days 1-3)
*Immediate fixes for user-facing issues*

### Task 1.1: Fix StatusBar 4D Volume Detection Bug
**Priority:** CRITICAL - Users can't see TimeSlider when 4D volumes are loaded
**File:** `/Users/bbuchsbaum/code/brainflow2/ui2/src/components/ui/StatusBar.tsx`

**Current Issue (Lines 70-76):**
```typescript
// ❌ BROKEN - Never updates when layers change
const has4DVolume = React.useMemo(() => {
  try {
    return getTimeNavigationService().has4DVolume();
  } catch {
    return false; // Swallows all errors
  }
}, []); // Empty dependency array
```

**Fix Implementation:**
```typescript
// ✅ FIXED - Properly subscribes to layer changes
const layers = useLayerStore(state => state.layers);
const has4DVolume = React.useMemo(() => {
  try {
    return layers.some(layer => 
      layer.volumeInfo?.timeSeriesInfo && 
      layer.volumeInfo.timeSeriesInfo.totalTimepoints > 1
    );
  } catch (error) {
    console.warn('Failed to detect 4D volume:', error);
    return false;
  }
}, [layers]);
```

**Testing Requirements:**
- Load 4D volume and verify TimeSlider appears
- Load 3D volume and verify TimeSlider doesn't appear
- Test layer removal and TimeSlider hiding

### Task 1.2: Add TimeSlider Scrubbing Throttling
**Priority:** HIGH - Prevents backend overload during rapid scrubbing
**File:** `/Users/bbuchsbaum/code/brainflow2/ui2/src/components/ui/TimeSlider.tsx`

**Current Issue (Lines 42-52):**
```typescript
// ❌ BROKEN - No throttling, 60+ updates per second
const handleScrub = useCallback((clientX: number) => {
  // Immediate updates on every mouse move pixel
  getTimeNavigationService().setTimepoint(timepoint);
}, [timeInfo]);
```

**Fix Implementation:**
```typescript
// ✅ FIXED - Throttled scrubbing with immediate UI feedback
import { throttle } from 'lodash-es';

// Immediate local state for smooth UI feedback
const [localTimepoint, setLocalTimepoint] = useState<number | null>(null);

// Throttled backend updates (16ms = 60fps max)
const throttledSetTimepoint = useCallback(
  throttle((timepoint: number) => {
    getTimeNavigationService().setTimepoint(timepoint);
    setLocalTimepoint(null); // Clear local override
  }, 16),
  [timeInfo]
);

const handleScrub = useCallback((clientX: number) => {
  const percentage = Math.max(0, Math.min(1, 
    (clientX - sliderRect.left) / sliderRect.width));
  const timepoint = Math.round(percentage * (totalTimepoints - 1));
  
  // Immediate UI feedback
  setLocalTimepoint(timepoint);
  
  // Throttled backend update
  throttledSetTimepoint(timepoint);
}, [timeInfo, throttledSetTimepoint]);

// Use local override for display if available
const displayTimepoint = localTimepoint ?? timeInfo.currentTimepoint;
```

**Performance Impact:** Reduces backend calls from ~960/second to 60/second during scrubbing

### Task 1.3: Fix Stale Closures in Keyboard Shortcuts
**Priority:** HIGH - Keyboard shortcuts may not work after component updates
**File:** `/Users/bbuchsbaum/code/brainflow2/ui2/src/hooks/useKeyboardShortcuts.ts`

**Current Issue (Line 142):**
```typescript
// ❌ BROKEN - Empty dependency array creates stale closures
useEffect(() => {
  document.addEventListener('keydown', handleKeyDown);
  return () => {
    document.removeEventListener('keydown', handleKeyDown);
  };
}, []); // Missing dependencies
```

**Fix Implementation:**
```typescript
// ✅ FIXED - Proper dependencies and cleanup
useEffect(() => {
  const handleKeyDown = (event: KeyboardEvent) => {
    // Skip if focused on input elements
    if (event.target instanceof HTMLInputElement || 
        event.target instanceof HTMLTextAreaElement) {
      return;
    }

    // Find matching shortcut with current service instances
    const shortcut = shortcuts.find(s => 
      s.key === event.key && 
      s.ctrlKey === event.ctrlKey &&
      s.shiftKey === event.shiftKey &&
      s.altKey === event.altKey
    );

    if (shortcut) {
      event.preventDefault();
      shortcut.action(); // Action closures are now fresh
    }
  };

  document.addEventListener('keydown', handleKeyDown);
  return () => {
    document.removeEventListener('keydown', handleKeyDown);
  };
}, [shortcuts]); // Proper dependency on shortcuts array
```

---

## Phase 2: Architecture Refactoring (Days 4-8)
*Eliminate anti-patterns and establish proper separation of concerns*

### Task 2.1: Create useTimeNavigation Hook
**Priority:** HIGH - Centralizes time navigation logic and eliminates service-store coupling
**New File:** `/Users/bbuchsbaum/code/brainflow2/ui2/src/hooks/useTimeNavigation.ts`

**Implementation:**
```typescript
import { useCallback } from 'react';
import { useViewStateStore } from '../stores/viewStateStore';
import { useLayerStore } from '../stores/layerStore';

export interface TimeInfo {
  currentTimepoint: number;
  totalTimepoints: number;
  timeDuration?: number;
  repetitionTime?: number;
}

export interface TimeNavigationActions {
  setTimepoint: (timepoint: number) => void;
  nextTimepoint: () => void;
  previousTimepoint: () => void;
  jumpTimepoints: (delta: number) => void;
  getTimeInfo: () => TimeInfo;
  has4DVolume: () => boolean;
}

export function useTimeNavigation(): TimeNavigationActions {
  const { viewState, setViewState } = useViewStateStore();
  const layers = useLayerStore(state => state.layers);

  const has4DVolume = useCallback(() => {
    return layers.some(layer => 
      layer.volumeInfo?.timeSeriesInfo && 
      layer.volumeInfo.timeSeriesInfo.totalTimepoints > 1
    );
  }, [layers]);

  const getTimeInfo = useCallback((): TimeInfo => {
    const timeSeries4D = layers.find(layer => 
      layer.volumeInfo?.timeSeriesInfo?.totalTimepoints > 1
    );

    if (!timeSeries4D?.volumeInfo?.timeSeriesInfo) {
      return {
        currentTimepoint: 0,
        totalTimepoints: 1
      };
    }

    const { timeSeriesInfo } = timeSeries4D.volumeInfo;
    return {
      currentTimepoint: viewState.timepoint ?? 0,
      totalTimepoints: timeSeriesInfo.totalTimepoints,
      timeDuration: timeSeriesInfo.timeDuration,
      repetitionTime: timeSeriesInfo.repetitionTime
    };
  }, [layers, viewState.timepoint]);

  const setTimepoint = useCallback((timepoint: number) => {
    const timeInfo = getTimeInfo();
    const clampedTimepoint = Math.max(0, 
      Math.min(timepoint, timeInfo.totalTimepoints - 1));
    
    setViewState(state => {
      state.timepoint = clampedTimepoint;
    });
  }, [setViewState, getTimeInfo]);

  const nextTimepoint = useCallback(() => {
    const timeInfo = getTimeInfo();
    const nextTime = (timeInfo.currentTimepoint + 1) % timeInfo.totalTimepoints;
    setTimepoint(nextTime);
  }, [setTimepoint, getTimeInfo]);

  const previousTimepoint = useCallback(() => {
    const timeInfo = getTimeInfo();
    const prevTime = timeInfo.currentTimepoint === 0 
      ? timeInfo.totalTimepoints - 1 
      : timeInfo.currentTimepoint - 1;
    setTimepoint(prevTime);
  }, [setTimepoint, getTimeInfo]);

  const jumpTimepoints = useCallback((delta: number) => {
    const timeInfo = getTimeInfo();
    const newTimepoint = timeInfo.currentTimepoint + delta;
    setTimepoint(newTimepoint);
  }, [setTimepoint, getTimeInfo]);

  return {
    setTimepoint,
    nextTimepoint,
    previousTimepoint,
    jumpTimepoints,
    getTimeInfo,
    has4DVolume
  };
}
```

### Task 2.2: Refactor TimeSlider to Use Hook
**Priority:** HIGH - Eliminates service dependency and fixes subscription issues
**File:** `/Users/bbuchsbaum/code/brainflow2/ui2/src/components/ui/TimeSlider.tsx`

**Current Issues:**
- Uses service singleton (violates React patterns)
- Only updates via events, not store subscriptions
- No throttling for performance

**Refactored Implementation:**
```typescript
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { throttle } from 'lodash-es';
import { useTimeNavigation } from '../../hooks/useTimeNavigation';

export function TimeSlider() {
  const timeNav = useTimeNavigation();
  const timeInfo = timeNav.getTimeInfo();
  
  // Local state for smooth scrubbing feedback
  const [localTimepoint, setLocalTimepoint] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  
  const sliderRef = useRef<HTMLDivElement>(null);

  // Throttled backend updates during scrubbing
  const throttledSetTimepoint = useCallback(
    throttle((timepoint: number) => {
      timeNav.setTimepoint(timepoint);
      setLocalTimepoint(null);
    }, 16),
    [timeNav]
  );

  const handleScrub = useCallback((clientX: number) => {
    if (!sliderRef.current) return;

    const rect = sliderRef.current.getBoundingClientRect();
    const percentage = Math.max(0, Math.min(1, 
      (clientX - rect.left) / rect.width));
    const timepoint = Math.round(percentage * (timeInfo.totalTimepoints - 1));
    
    // Immediate UI feedback
    setLocalTimepoint(timepoint);
    
    // Throttled backend update
    throttledSetTimepoint(timepoint);
  }, [timeInfo.totalTimepoints, throttledSetTimepoint]);

  // Rest of component implementation...
  
  // Use local override or actual timepoint
  const displayTimepoint = localTimepoint ?? timeInfo.currentTimepoint;
  
  return (
    <div className="time-slider">
      {/* Slider implementation using displayTimepoint */}
    </div>
  );
}
```

### Task 2.3: Refactor Keyboard Shortcuts to Use Hook
**Priority:** MEDIUM - Eliminates service dependencies in shortcuts
**File:** `/Users/bbuchsbaum/code/brainflow2/ui2/src/hooks/useKeyboardShortcuts.ts`

**Implementation:**
```typescript
import { useEffect } from 'react';
import { useTimeNavigation } from './useTimeNavigation';

export function useKeyboardShortcuts() {
  const timeNav = useTimeNavigation();

  useEffect(() => {
    const shortcuts = [
      {
        key: 'ArrowLeft',
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        action: () => timeNav.previousTimepoint()
      },
      {
        key: 'ArrowRight', 
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        action: () => timeNav.nextTimepoint()
      },
      {
        key: 'ArrowLeft',
        ctrlKey: false, 
        shiftKey: true,
        altKey: false,
        action: () => timeNav.jumpTimepoints(-10)
      },
      {
        key: 'ArrowRight',
        ctrlKey: false,
        shiftKey: true, 
        altKey: false,
        action: () => timeNav.jumpTimepoints(10)
      }
    ];

    const handleKeyDown = (event: KeyboardEvent) => {
      // Skip if focused on input elements
      if (event.target instanceof HTMLInputElement || 
          event.target instanceof HTMLTextAreaElement) {
        return;
      }

      const shortcut = shortcuts.find(s => 
        s.key === event.key && 
        s.ctrlKey === event.ctrlKey &&
        s.shiftKey === event.shiftKey &&
        s.altKey === event.altKey
      );

      if (shortcut) {
        event.preventDefault();
        shortcut.action();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [timeNav]); // Proper dependency on hook
}
```

### Task 2.4: Refactor SliceView Time Integration
**Priority:** MEDIUM - Simplifies wheel event handling
**File:** `/Users/bbuchsbaum/code/brainflow2/ui2/src/components/views/SliceView.tsx`

**Current Issue (Lines 306-335):**
Complex conditional logic with service dependencies

**Refactored Implementation:**
```typescript
// Add to imports
import { useTimeNavigation } from '../../hooks/useTimeNavigation';

// In component body
const timeNav = useTimeNavigation();

const handleWheel = useCallback((event: WheelEvent) => {
  event.preventDefault();
  
  const has4D = timeNav.has4DVolume();
  const navMode = getSliceNavigationService().getMode();
  
  // Simplified logic
  const shouldNavigateTime = has4D && (
    (navMode === 'time' && !event.shiftKey) || 
    (navMode === 'slice' && event.shiftKey)
  );

  if (shouldNavigateTime) {
    const delta = event.deltaY > 0 ? 1 : -1;
    timeNav.jumpTimepoints(delta);
    
    // Show time overlay
    const timeInfo = timeNav.getTimeInfo();
    showTimeOverlay(`${timeInfo.currentTimepoint + 1}/${timeInfo.totalTimepoints}`);
  } else {
    // Handle slice navigation
    const delta = event.deltaY > 0 ? 1 : -1;
    getSliceNavigationService().navigateSliceByDelta(delta);
  }
}, [timeNav]);
```

---

## Phase 3: Performance Optimizations (Days 9-12)
*Improve user experience with smooth interactions*

### Task 3.1: Implement Debounced Backend Updates
**Priority:** MEDIUM - Reduces backend load during rapid interactions
**File:** `/Users/bbuchsbaum/code/brainflow2/ui2/src/hooks/useTimeNavigation.ts`

**Enhancement:**
```typescript
import { debounce } from 'lodash-es';

// Add to useTimeNavigation hook
const debouncedBackendUpdate = useCallback(
  debounce((timepoint: number) => {
    // Trigger backend re-render after user stops interacting
    // This is in addition to the immediate store update
    console.log('Backend update for timepoint:', timepoint);
  }, 100), // 100ms delay after last interaction
  []
);

const setTimepoint = useCallback((timepoint: number) => {
  const timeInfo = getTimeInfo();
  const clampedTimepoint = Math.max(0, 
    Math.min(timepoint, timeInfo.totalTimepoints - 1));
  
  // Immediate store update for UI responsiveness
  setViewState(state => {
    state.timepoint = clampedTimepoint;
  });
  
  // Debounced backend update
  debouncedBackendUpdate(clampedTimepoint);
}, [setViewState, getTimeInfo, debouncedBackendUpdate]);
```

### Task 3.2: Add Playback Controls
**Priority:** LOW - Nice-to-have feature for automatic time progression
**File:** `/Users/bbuchsbaum/code/brainflow2/ui2/src/hooks/useTimeNavigation.ts`

**Enhancement:**
```typescript
// Add playback state to hook
const [isPlaying, setIsPlaying] = useState(false);
const [playbackSpeed, setPlaybackSpeed] = useState(1000); // ms between frames

useEffect(() => {
  if (!isPlaying) return;

  const interval = setInterval(() => {
    const timeInfo = getTimeInfo();
    const nextTime = (timeInfo.currentTimepoint + 1) % timeInfo.totalTimepoints;
    setTimepoint(nextTime);
  }, playbackSpeed);

  return () => clearInterval(interval);
}, [isPlaying, playbackSpeed, setTimepoint, getTimeInfo]);

// Add to return object
return {
  // ... existing methods
  isPlaying,
  setIsPlaying,
  playbackSpeed,
  setPlaybackSpeed,
  togglePlayback: () => setIsPlaying(!isPlaying)
};
```

---

## Phase 4: Service Architecture Cleanup (Days 13-15)
*Remove deprecated patterns and establish clean architecture*

### Task 4.1: Deprecate TimeNavigationService
**Priority:** LOW - Remove legacy service once hook adoption is complete
**File:** `/Users/bbuchsbaum/code/brainflow2/ui2/src/services/TimeNavigationService.ts`

**Migration Strategy:**
1. Add deprecation warnings to all service methods
2. Update documentation to point to useTimeNavigation hook
3. Remove service once all components migrated
4. Clean up service registration and singleton management

**Deprecation Implementation:**
```typescript
// Add to all methods
console.warn('TimeNavigationService is deprecated. Use useTimeNavigation hook instead.');
```

### Task 4.2: Remove Dual State Propagation
**Priority:** MEDIUM - Eliminate EventBus usage for time state changes
**Files to Modify:**
- `/Users/bbuchsbaum/code/brainflow2/ui2/src/hooks/useTimeNavigation.ts`
- Any components listening to 'time.changed' events

**Implementation:**
Remove all `eventBus.emit('time.changed')` calls since Zustand store updates will handle all component notifications automatically.

### Task 4.3: Update Component Dependencies
**Priority:** LOW - Ensure all time-related components use the new hook
**Files to Update:**
- Any remaining components using TimeNavigationService
- Components with EventBus time event listeners

---

## Testing Strategy

### Unit Tests
**Files to Test:**
- `/Users/bbuchsbaum/code/brainflow2/ui2/src/hooks/useTimeNavigation.test.ts`
- `/Users/bbuchsbaum/code/brainflow2/ui2/src/components/ui/TimeSlider.test.tsx`

**Test Cases:**
```typescript
describe('useTimeNavigation', () => {
  it('should handle timepoint changes within bounds', () => {
    // Test clamping behavior
  });

  it('should detect 4D volumes correctly', () => {
    // Test has4DVolume logic
  });

  it('should handle navigation edge cases', () => {
    // Test wrap-around, empty state, etc.
  });
});

describe('TimeSlider', () => {
  it('should throttle rapid scrubbing', () => {
    // Test throttling behavior
  });

  it('should provide immediate UI feedback', () => {
    // Test local state during scrubbing
  });
});
```

### Integration Tests
**Test Scenarios:**
1. Load 4D volume → TimeSlider appears
2. Wheel navigation in SliceView
3. Keyboard shortcuts functionality
4. Rapid scrubbing performance
5. Multiple component coordination

### Performance Tests
**Benchmarks:**
- Scrubbing should not exceed 60 backend calls/second
- Memory usage should not increase during extended navigation
- UI should remain responsive during rapid interactions

---

## Risk Mitigation

### Phase 1 Risks
**Risk:** StatusBar fix breaks existing functionality
**Mitigation:** 
- Test with both 3D and 4D volumes
- Verify layer loading/unloading behavior
- Add fallback error handling

**Risk:** Throttling changes user experience
**Mitigation:**
- Use local state for immediate visual feedback
- Benchmark performance before and after
- Allow configuration of throttle timing

### Phase 2 Risks  
**Risk:** Hook migration breaks existing components
**Mitigation:**
- Implement parallel to existing service
- Gradual migration component by component
- Keep service as fallback during transition

**Risk:** Store subscription performance impact
**Mitigation:**
- Use selective subscriptions (only needed state)
- Profile memory usage during migration
- Implement proper cleanup in useEffect

### Phase 3 Risks
**Risk:** Debouncing delays important updates
**Mitigation:**
- Separate immediate UI updates from backend updates
- Use appropriate debounce timing (100ms)
- Test with high-frequency interactions

### Phase 4 Risks
**Risk:** Removing EventBus breaks other features
**Mitigation:**
- Audit all 'time.changed' event usages
- Keep EventBus for non-state notifications
- Thorough integration testing before removal

---

## Rollback Procedures

### Phase 1 Rollback
If critical bugs are introduced:
1. Revert StatusBar to service-based detection (temporary)
2. Remove throttling from TimeSlider
3. Restore original keyboard shortcut dependencies

### Phase 2 Rollback  
If hook migration causes issues:
1. Keep TimeNavigationService active
2. Revert components to service usage
3. Remove useTimeNavigation hook

### Phase 3 Rollback
If performance optimizations cause problems:
1. Remove debouncing from backend updates
2. Disable playback controls
3. Revert to immediate backend calls

### Phase 4 Rollback
If service removal breaks functionality:
1. Restore TimeNavigationService singleton
2. Re-enable dual state propagation
3. Restore EventBus time event emissions

---

## Success Criteria

### Phase 1 Success Metrics
- [ ] StatusBar shows TimeSlider when 4D volume loaded
- [ ] TimeSlider scrubbing produces <60 backend calls/second
- [ ] Keyboard shortcuts work after component re-renders
- [ ] No regressions in existing time navigation

### Phase 2 Success Metrics  
- [ ] useTimeNavigation hook passes all unit tests
- [ ] Components using hook show same behavior as before
- [ ] No direct service.getState() calls in codebase
- [ ] Store subscriptions work correctly

### Phase 3 Success Metrics
- [ ] Smooth user experience during rapid navigation
- [ ] Backend load reduced during high-frequency interactions
- [ ] Playback controls work correctly (if implemented)
- [ ] No performance regressions

### Phase 4 Success Metrics
- [ ] TimeNavigationService fully removed
- [ ] No dual state propagation (single source of truth)
- [ ] Clean component dependencies
- [ ] Comprehensive test coverage

---

## Implementation Checklist

### Pre-Implementation
- [ ] Code review of investigation reports
- [ ] Backup current implementation
- [ ] Set up performance monitoring
- [ ] Create test cases for regression detection

### Phase 1 Implementation
- [ ] Task 1.1: StatusBar 4D detection fix
- [ ] Task 1.2: TimeSlider throttling implementation  
- [ ] Task 1.3: Keyboard shortcuts dependency fix
- [ ] Phase 1 testing and verification

### Phase 2 Implementation
- [ ] Task 2.1: useTimeNavigation hook creation
- [ ] Task 2.2: TimeSlider hook migration
- [ ] Task 2.3: Keyboard shortcuts hook migration
- [ ] Task 2.4: SliceView refactoring
- [ ] Phase 2 testing and verification

### Phase 3 Implementation
- [ ] Task 3.1: Debounced backend updates
- [ ] Task 3.2: Playback controls (optional)
- [ ] Performance testing and optimization
- [ ] Phase 3 testing and verification

### Phase 4 Implementation
- [ ] Task 4.1: TimeNavigationService deprecation
- [ ] Task 4.2: Dual state propagation removal
- [ ] Task 4.3: Component dependency cleanup
- [ ] Final integration testing

### Post-Implementation
- [ ] Performance benchmarking
- [ ] User acceptance testing
- [ ] Documentation updates
- [ ] Code review and cleanup

---

## Conclusion

This implementation plan provides a systematic approach to fixing the 4D time navigation issues while minimizing risk through phased delivery. The plan prioritizes user-facing bugs first, then addresses architectural issues, and finally implements performance optimizations.

The key insight is that the current dual state propagation pattern (Zustand + EventBus) creates race conditions and complexity. By consolidating on Zustand stores with the useTimeNavigation hook pattern, we achieve:

1. **Single source of truth** for time state
2. **Proper React patterns** with hooks instead of singletons  
3. **Testable architecture** with dependency injection
4. **Performance optimizations** through throttling and debouncing
5. **Clean separation of concerns** between UI and business logic

The phased approach allows for validation at each step and provides clear rollback points if issues arise. The success criteria and testing strategy ensure that the refactoring maintains existing functionality while improving architecture and performance.

**Next Steps:** Begin Phase 1 implementation with StatusBar fix and TimeSlider throttling as the highest priority items for immediate user experience improvement.