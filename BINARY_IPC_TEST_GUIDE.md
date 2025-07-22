# Binary IPC Performance Test Guide

## Overview
We've implemented a binary IPC optimization that avoids JSON serialization of PNG data, which should provide a 1.5-2× performance improvement.

## Implementation Details

### Backend Changes
- Added new command: `apply_and_render_view_state_binary`
- Uses `tauri::ipc::Response::new(png_data)` to signal raw binary transfer
- Original command preserved for fallback

### Frontend Changes
- Added feature flag: `useBinaryIPC` (default: true)
- Automatic fallback to JSON path if binary fails
- Global toggle function for testing

## Testing Instructions

### 1. Build and Run
```bash
# Build the Rust backend first
cd /Users/bbuchsbaum/code/brainflow2
cargo build

# Run the application
cargo tauri dev
```

### 2. Load a Test File
Load any NIfTI file to start rendering

### 3. Monitor Performance

#### Console Logs to Watch
- `[ApiService] Using binary IPC optimization` - Confirms binary path is active
- `[ApiService] Backend returned Uint8Array directly after Xms` - Shows transfer time
- `Image data type: [object Uint8Array]` - Confirms correct data type

#### Compare Performance
1. With binary IPC (default):
   - Note the transfer time in console
   - Should see `Uint8Array` type

2. Disable binary IPC:
   - Open browser console
   - Run: `setBinaryIPC(false)`
   - Load another file or trigger render
   - Should see `[ApiService] Using slow JSON path`
   - Note the increased transfer time

3. Re-enable binary IPC:
   - Run: `setBinaryIPC(true)`

### 4. Expected Results

| Metric | JSON Path (Slow) | Binary IPC (Fast) | Improvement |
|--------|------------------|-------------------|-------------|
| Transfer Time | 15-25ms | 5-10ms | 2-3× faster |
| Data Type | `number[]` → `Uint8Array` | Direct `Uint8Array` | No conversion |
| Memory Usage | 3× image size | 1× image size | 66% reduction |

### 5. Troubleshooting

If binary IPC fails:
- Check console for: `[ApiService] Binary IPC failed, falling back to JSON path`
- Verify Tauri API version: Should be `@tauri-apps/api` v2.6.0+
- Ensure backend was rebuilt after changes

### 6. Performance Monitoring

To measure actual improvement:
1. Open browser DevTools Performance tab
2. Start recording
3. Load a file or pan/zoom to trigger renders
4. Stop recording
5. Look for `invoke` calls in the timeline
6. Compare durations with binary IPC on/off

## Technical Details

### Why It's Faster
- **Before**: `Vec<u8>` → JSON array `[137,80,78,71,...]` → parse → `Uint8Array`
- **After**: `Vec<u8>` → Direct binary transfer → `Uint8Array`

### Memory Impact
- JSON array uses ~4 bytes per pixel byte (number + comma + space)
- Binary transfer uses exactly 1 byte per pixel byte

### Future Optimizations
1. **Raw RGBA Transfer**: Skip PNG encoding entirely (3-5× improvement)
2. **Web Workers**: Move PNG decoding off main thread
3. **Shared Memory**: Direct GPU buffer access (10× improvement)

## Rollback Instructions

If issues arise, disable binary IPC:
1. In console: `setBinaryIPC(false)`
2. Or in code: Change `private useBinaryIPC: boolean = true` to `false`
3. The original JSON path remains fully functional