# Raw RGBA Debugging Steps

## Current Symptoms
1. `window.setRawRGBA(false)` - Works, shows brain image (PNG path)
2. `window.setRawRGBA(true)` - Shows black screen, errors about invalid PNG

## What We've Fixed So Far
1. ✅ Removed `colorSpaceConversion: 'none'` to allow proper linear→sRGB conversion
2. ✅ Added alpha channel verification in backend
3. ✅ Fixed format detection logic to always treat raw RGBA path as raw RGBA
4. ✅ Added better error handling and validation

## Debugging Steps

### 1. Check Backend Console
When you set `window.setRawRGBA(true)` and trigger a render, look for:

**Expected (Raw RGBA)**:
```
🚀 RAW RGBA PATH: apply_and_render_view_state_raw called
🚀 RAW RGBA: Skipping PNG encoding, returning raw pixel data
🚀 RAW RGBA: Returning X bytes (8 byte header + Y RGBA bytes)
```

**Wrong (PNG)**:
```
📊 PNG PATH: apply_and_render_view_state called
⏱️ PNG encoding took: Xms
Backend: Encoded RGBA to PNG - X bytes
```

### 2. Check Browser Console
Look for the debug output:

```
🔍 First 8 bytes (hex): ?? ?? ?? ?? ?? ?? ?? ??
🔍 First 8 bytes (decimal): ??, ??, ??, ??, ??, ??, ??, ??
```

**If Raw RGBA (correct)**:
- First 4 bytes = width (little-endian u32)
- Next 4 bytes = height (little-endian u32)
- Example for 512x512: `00 02 00 00 00 02 00 00`

**If PNG (wrong)**:
- Will show PNG signature: `89 50 4e 47 0d 0a 1a 0a`
- Decimal: `137, 80, 78, 71, 13, 10, 26, 10`

### 3. Possible Root Causes

1. **Command Not Found**: The `apply_and_render_view_state_raw` command might not be accessible
   - Check: Is the command registered in Tauri?
   - Check: Are permissions correct?

2. **Backend Using Wrong Path**: Even with raw RGBA request, backend might use PNG path
   - Check: Is `return_raw_rgba` parameter being passed correctly?
   - Check: Is the internal function being called with correct flag?

3. **IPC Layer Issue**: Tauri IPC might be modifying the response
   - Check: Is binary data being handled correctly?
   - Check: Is Response wrapper working properly?

### 4. Quick Test Commands

```javascript
// 1. Enable raw RGBA
window.setRawRGBA(true)

// 2. Check current setting
console.log('Raw RGBA enabled:', window.apiService?.useRawRGBA)

// 3. Trigger render and watch console
window.debugRawRGBA()

// 4. If still seeing PNG, check if command exists
// Look for errors about unknown command
```

### 5. Next Steps Based on Findings

**If backend shows PNG encoding messages**:
- The raw RGBA command isn't being called
- Check command registration and routing

**If backend shows raw RGBA but browser gets PNG**:
- IPC layer issue
- Check Response wrapper handling

**If dimensions are invalid (huge numbers)**:
- We're reading PNG data as raw RGBA
- Backend is returning wrong format

**If everything looks correct but still black**:
- Color space issue remains
- Check alpha channel values
- Try debug brightening: `window.setDebugBrighten(true)`