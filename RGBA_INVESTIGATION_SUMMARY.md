# Raw RGBA Investigation Summary

## Current Status

The raw RGBA optimization is not working correctly. Here's what we know:

### Symptoms
1. **PNG Mode (`setRawRGBA(false)`)**: 
   - Image displays correctly
   - Shows error: "Data is not a valid PNG file!" 
   - But continues to work

2. **Raw RGBA Mode (`setRawRGBA(true)`)**:
   - Image disappears (black screen)
   - Shows error: "Data is not a valid PNG file!"
   - Plus: "InvalidStateError: Cannot decode the data in the argument to createImageBitmap"

### What We've Fixed
1. ✅ Removed `colorSpaceConversion: 'none'` to fix linear RGB → sRGB conversion
2. ✅ Changed default to PNG mode to fix black screen on initial load
3. ✅ Added comprehensive debugging output
4. ✅ Verified backend implementation looks correct
5. ✅ Confirmed command is registered and permissions are set

### Investigation Results

#### Backend Code Review
- `apply_and_render_view_state_raw` command exists and is properly registered
- The command is in `build.rs` COMMANDS array
- Permissions include `allow-apply-and-render-view-state-raw`
- Backend implementation correctly branches on `return_raw_rgba` flag
- When true, it returns format: `[width:u32][height:u32][rgba_data...]`

#### Frontend Code Review
- `apiService.ts` correctly routes to different commands based on `useRawRGBA`
- Raw RGBA path expects 8-byte header (width, height as little-endian u32)
- Proper validation and error handling in place

## Hypothesis

The "Data is not a valid PNG file!" error appearing in BOTH modes suggests:

1. **Backend might always be returning the same format** regardless of which command is called
2. **Or the frontend is receiving different data than expected** due to IPC layer issues

## Diagnostic Scripts Created

1. **`debug_rgba_comprehensive.js`** - Intercepts transport calls to analyze raw data
2. **`test_rgba_command.js`** - Tests command accessibility directly
3. **`diagnose_rgba_issue.js`** - Comprehensive test comparing both modes

## Next Steps

1. **Run diagnostic script**:
   ```javascript
   window.diagnoseRGBAIssue()
   ```

2. **Check output for**:
   - Which backend command is actually being called
   - What the first 8 bytes of data look like
   - Whether dimensions make sense for raw RGBA

3. **Check backend console for**:
   - "🚀 RAW RGBA PATH" vs "🚀 BINARY IPC PATH" messages
   - Verify the correct path is being taken

4. **Possible fixes based on findings**:
   - If backend always returns PNG: Fix the branching logic
   - If dimensions are wrong: Check endianness or data corruption
   - If command not found: Check Tauri IPC routing

## Quick Test Commands

```javascript
// Check current state
window.rgbaStatus()

// Test PNG mode (should work)
window.setRawRGBA(false)

// Test raw RGBA mode (currently broken)
window.setRawRGBA(true)

// Run comprehensive diagnosis
window.diagnoseRGBAIssue()
```

## Expected vs Actual

**Expected for Raw RGBA**:
- First 8 bytes: dimensions (e.g., `00 02 00 00 00 02 00 00` for 512x512)
- Backend logs: "RAW RGBA PATH" messages
- No PNG encoding time

**Actually seeing**:
- PNG signature in data (?)
- "Invalid PNG" errors
- Black screen

This investigation will help identify exactly where the raw RGBA path is failing.