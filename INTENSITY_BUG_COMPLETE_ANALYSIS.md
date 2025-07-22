# Complete Analysis of Intensity Snapback Bug

## The Bug Mechanism

1. **User drags intensity slider** in ProSlider component
2. **ProSlider updates local state** and calls onChange (throttled to 50ms)
3. **LayerPanel.handleRenderUpdate** is called, which:
   - Marks layer as dirty
   - Updates ViewState
   - Updates layerStore
4. **ViewState update triggers** multiple subscribers:
   - App.tsx threshold fix subscription
   - StoreSyncService ViewState subscription
   - useStatusBarUpdates subscription
   - Coalescing middleware (for backend update)
5. **ProSlider's useEffect** (lines 121-133) detects external value change
6. **ProSlider resets** localValue to the external value (which is still 1970-7878)
7. **User sees instant snapback**

## The Root Problem

The ProSlider component has a race condition:
- User changes trigger local state updates
- But ViewState hasn't been updated yet (or is being processed)
- ProSlider's useEffect sees the "old" value from props and resets to it

## All Relevant Files

### Core Problem Files
1. **`/ui2/src/components/ui/ProSlider.tsx`**
   - Lines 121-133: useEffect that resets localValue when props change
   - This is the direct cause of the snapback

2. **`/ui2/src/components/panels/LayerPanel.tsx`**
   - Line 166: Binds ProSlider value to `selectedRender.intensity`
   - Lines 39-45: Gets selectedRender from ViewState

### State Management
3. **`/ui2/src/stores/viewStateStore.ts`**
   - Contains ViewState with intensity values
   - Has multiple subscribers

4. **`/ui2/src/stores/layerStore.ts`**
   - Lines 86-87: Creates 20-80% defaults
   - Line 134: Uses createDefaultRender

### Services
5. **`/ui2/src/services/StoreSyncService.ts`**
   - Lines 397+: ViewState subscription
   - Multiple event handlers that update ViewState

6. **`/ui2/src/services/LayerApiImpl.ts`**
   - Lines 72-73: Sets initial 20-80% values

### Hooks and App
7. **`/ui2/src/App.tsx`**
   - Lines 105-130: ViewState subscription for threshold fix
   - Might trigger ViewState updates

8. **`/ui2/src/hooks/useServicesInit.ts`**
   - Sets up coalescing middleware
   - Manages backend sync

### Backend Logs Show
- Intensity values ARE being sent: `intensity=[1969.6, 7878.4]`
- The backend is receiving the default values
- This confirms the frontend is the problem

## The Fix Options

1. **Fix ProSlider's useEffect** to not reset during user interaction
2. **Add a "isUserInteracting" flag** to prevent external updates
3. **Use uncontrolled component** during dragging
4. **Debounce external value updates** longer than user input
5. **Fix the race condition** in state updates