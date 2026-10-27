# How to Verify Binary IPC is Working

## Visual Indicators

### Backend (Rust) Logs
Look for these distinctive markers in the terminal where you run `cargo tauri dev`:

#### Binary Path (Fast) ✅
```
🚀 BINARY IPC PATH: apply_and_render_view_state_binary called
🚀 This should use Tauri's raw binary transfer, avoiding JSON serialization
🚀 BINARY IPC: PNG data size: 123456 bytes, render took 5.2ms
🚀 BINARY IPC: Wrapping in tauri::ipc::Response for zero-copy transfer
```

#### JSON Path (Slow) ❌
```
📊 JSON IPC PATH: apply_and_render_view_state called
📊 WARNING: This uses JSON serialization of Vec<u8>, which is SLOW!
```

### Frontend (Browser Console) Logs
Open browser DevTools console and look for:

#### Binary Path (Fast) ✅
```
🚀 [ApiService] BINARY IPC ENABLED - Calling apply_and_render_view_state_binary
🚀 [ApiService] This should avoid JSON serialization of PNG data
🚀 [ApiService 125ms] SUCCESS: Binary IPC returned Uint8Array directly after 8ms
🚀 [ApiService] Data type check: [object Uint8Array]
```

#### JSON Path (Slow) ❌
```
📊 [ApiService] JSON PATH SELECTED (binary IPC disabled by user)
📊 [ApiService] WARNING: This will serialize PNG as JSON array - SLOW!
📊 [ApiService 543ms] JSON PATH: Returned number[] after 25ms
📊 [ApiService] Had to convert number[] to Uint8Array - extra overhead!
```

#### Binary Path Failed (Fallback) ⚠️
```
❌ [ApiService] BINARY IPC FAILED! Error: [error details]
❌ [ApiService] Falling back to slow JSON path...
📊 [ApiService] FALLBACK: Used JSON path, returned number[]
```

## Quick Test

1. **Start the app**: `cargo tauri dev`
2. **Open browser console**: Right-click → Inspect → Console
3. **Load a NIfTI file**
4. **Check the logs**: You should see 🚀 emojis in both backend and frontend

## Toggle Between Paths

In browser console:
```javascript
// Check current state
setBinaryIPC(true)  // Enable binary IPC (fast) 🚀
setBinaryIPC(false) // Disable binary IPC (slow) 📊
```

## Performance Verification

1. **With Binary IPC**: Look for transfer times like "8ms", "10ms"
2. **Without Binary IPC**: Look for transfer times like "25ms", "30ms"
3. **Data type**: Binary shows `[object Uint8Array]`, JSON shows conversion from `number[]`

## Network Tab Verification

1. Open DevTools → Network tab
2. Filter by "apply_and_render"
3. You should see either:
   - `apply_and_render_view_state_binary` (binary path)
   - `apply_and_render_view_state` (JSON path)

## If Binary IPC Isn't Working

Check for:
1. ❌ error in console
2. Fallback messages
3. Only 📊 emojis (no 🚀)
4. Transfer times > 20ms consistently
5. Data type conversions mentioned

The emojis make it very clear which path is being used!