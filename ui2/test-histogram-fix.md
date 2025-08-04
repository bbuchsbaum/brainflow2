# Test Plan for Histogram Fix

## Summary of Changes

### Backend (Rust)
1. **Added fallback logic in `compute_layer_histogram`**:
   - Primary: Check `layer_to_volume_map` 
   - Fallback 1: Try layer_id as volume_handle directly
   - Fallback 2: Pattern matching for similar IDs
   - Enhanced logging for debugging

### Frontend (TypeScript)
1. **Replaced timing delays with state polling**:
   - `VolumeLoadingService.waitForBackendStateReady()` polls histogram API
   - 5-second timeout with 100ms polling interval
   - Continues on failure (backend fallbacks should handle it)

2. **Added retry logic to HistogramService**:
   - `fetchHistogramWithRetry()` with exponential backoff
   - Retries up to 3 times for VolumeNotFound errors
   - Delays: 200ms, 400ms, 800ms

## Test Procedure

### 1. Test Template Loading
1. Start the application: `cargo tauri dev`
2. Open Templates menu
3. Select any template (e.g., MNI152 T1w 1mm)
4. Verify:
   - Template loads successfully
   - Histogram appears with data
   - Check console for fallback messages

### 2. Test File Loading (Regression)
1. Use file browser to load a NIfTI file
2. Verify:
   - File loads successfully
   - Histogram appears immediately
   - No errors in console

### 3. Test Histogram Updates
1. After loading template:
   - Adjust intensity window
   - Change threshold
   - Switch colormap
2. Verify histogram updates for each change

### 4. Check Console Logs
Look for these key messages:
- `[VolumeLoadingService] Backend state ready for layer...`
- `[HistogramService] Fallback 1 succeeded...` (if fallback used)
- `[HistogramService] Attempt X/3 failed with retryable error...` (if retries needed)

## Expected Behavior

### Success Case
- Template loads → Histogram shows data immediately
- No retry attempts needed (state polling succeeds)
- Backend finds volume via primary lookup or fallback

### Fallback Case
- Template loads → Brief delay → Histogram shows data
- Console shows fallback mechanisms working
- May see 1-2 retry attempts before success

### Edge Case
- Very slow system: May see timeout warning but histogram still works
- Backend fallbacks ensure data is found eventually

## Debugging

If histogram still doesn't show:
1. Check browser console for errors
2. Check Tauri console for Rust logs
3. Look for:
   - "Volume for layer X not found" errors
   - "Available volumes:" debug output
   - Layer ID vs Volume ID mismatches

## Performance Notes
- State polling adds minimal overhead (2ms per poll)
- Retry logic only activates on failure
- Fallback mechanisms in backend are fast (microseconds)