# Raw RGBA Status Update

## Changes Made

1. **Changed default to PNG mode** (`useRawRGBA = false`)
   - This fixes the black screen on initial load
   - The app should now work normally by default

2. **Identified the issue**:
   - Raw RGBA was enabled by default
   - On initial render, raw RGBA validation was failing
   - Code was falling back to PNG decoding
   - But the data wasn't PNG format, causing "Invalid PNG" errors
   - Result: Black screen

## Current Status

- **PNG Mode** (default): Should work correctly
- **Raw RGBA Mode**: Still needs debugging

## Next Steps to Debug Raw RGBA

1. **With the app now loading properly**, you can test raw RGBA:
   ```javascript
   window.setRawRGBA(true)  // Enable raw RGBA
   // Move crosshair to trigger render
   ```

2. **Check the console output** for:
   - "🔍 First 8 bytes (hex):" - What format is the data?
   - "🚀 Raw RGBA dimensions:" - Are dimensions valid?
   - Any validation errors

3. **Check backend console** for:
   - Which command is being called
   - Whether raw RGBA or PNG encoding is happening

## Possible Issues with Raw RGBA

1. **Backend returning PNG anyway** - Check if `apply_and_render_view_state_raw` is being called
2. **Invalid dimensions in header** - First 8 bytes might be corrupted
3. **IPC layer issue** - Binary data might be getting corrupted in transit
4. **Command not found** - The raw RGBA command might not be properly registered

## Testing Commands

```javascript
// Check current mode
console.log('Raw RGBA enabled:', window.apiService?.useRawRGBA)

// Test PNG mode (should work)
window.setRawRGBA(false)

// Test raw RGBA mode (for debugging)
window.setRawRGBA(true)

// Run diagnostic
window.debugRawRGBA()
```

The app should now load and work properly in PNG mode. We can debug the raw RGBA issue without blocking normal usage.