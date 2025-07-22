# Raw RGBA Implementation Plan

## Goal
Eliminate PNG encoding overhead (~85ms) by transferring raw RGBA pixels directly.

## Implementation Steps

### 1. Backend Refactoring

Create an internal function that separates rendering from encoding:

```rust
async fn apply_and_render_view_state_internal(
    view_state_json: String,
    state: State<'_, BridgeState>,
    return_raw_rgba: bool
) -> BridgeResult<Vec<u8>> {
    // ... all the existing rendering logic ...
    
    // Get the raw RGBA data from GPU
    let frame_result = service.render_and_read_pixels(width, height)?;
    let rgba_data = frame_result.image_data;
    
    if return_raw_rgba {
        // Return raw RGBA with dimensions header
        let mut raw_buffer = Vec::with_capacity(8 + rgba_data.len());
        raw_buffer.extend_from_slice(&width.to_le_bytes());
        raw_buffer.extend_from_slice(&height.to_le_bytes());
        raw_buffer.extend_from_slice(&rgba_data);
        Ok(raw_buffer)
    } else {
        // Existing PNG encoding logic
        let mut png_data = Vec::new();
        let encoder = PngEncoder::new_with_quality(...);
        encoder.write_image(&rgba_data, width, height)?;
        Ok(png_data)
    }
}
```

### 2. Update Command Implementations

```rust
#[command]
async fn apply_and_render_view_state(
    view_state_json: String,
    state: State<'_, BridgeState>
) -> BridgeResult<Vec<u8>> {
    apply_and_render_view_state_internal(view_state_json, state, false).await
}

#[command]
async fn apply_and_render_view_state_raw(
    view_state_json: String,
    state: State<'_, BridgeState>
) -> Result<tauri::ipc::Response, BridgeError> {
    let raw_data = apply_and_render_view_state_internal(view_state_json, state, true).await?;
    Ok(tauri::ipc::Response::new(raw_data))
}
```

### 3. Frontend Raw RGBA Decoding

```typescript
if (treatAsRawRGBA && byteArray.length > 8) {
    // Raw RGBA format: [width: u32][height: u32][rgba_data...]
    const view = new DataView(byteArray.buffer, byteArray.byteOffset);
    const width = view.getUint32(0, true);  // little-endian
    const height = view.getUint32(4, true);
    const rgbaData = byteArray.slice(8);
    
    // Validate dimensions
    if (rgbaData.length !== width * height * 4) {
        throw new Error(`Invalid raw RGBA data: expected ${width * height * 4} bytes, got ${rgbaData.length}`);
    }
    
    // Create ImageData from raw RGBA
    const imageData = new ImageData(new Uint8ClampedArray(rgbaData), width, height);
    
    // Convert to ImageBitmap
    return await createImageBitmap(imageData);
}
```

### 4. Feature Detection

Add logic to detect if raw RGBA is working correctly:

```typescript
private async detectRawRGBASupport(): Promise<boolean> {
    try {
        const testData = await this.transport.invoke<Uint8Array>(
            'apply_and_render_view_state_raw',
            { viewStateJson: JSON.stringify(minimalTestState) }
        );
        
        // Check if it's raw RGBA (has 8-byte header) or PNG (has PNG signature)
        if (testData.length > 8) {
            const isPNG = testData[0] === 0x89 && testData[1] === 0x50;
            return !isPNG;
        }
        return false;
    } catch {
        return false;
    }
}
```

## Expected Benefits

- **Eliminate PNG encoding**: Save ~85ms per frame
- **Reduce memory allocation**: No intermediate PNG buffer
- **Simpler data path**: Direct GPU → Frontend transfer

## Current Blockers

1. Need to refactor `apply_and_render_view_state` to extract rendering logic
2. Risk of breaking existing functionality during refactor
3. Need thorough testing of raw RGBA data transfer

## Testing Strategy

1. Add unit tests for raw RGBA format encoding/decoding
2. Visual comparison tests between PNG and raw RGBA paths
3. Performance benchmarks to verify improvement
4. Edge case testing (empty images, large images, etc.)