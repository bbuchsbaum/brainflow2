# Raw RGBA vs PNG Rendering Code for Expert Review

## Problem Statement
- PNG encoding path: Images render correctly
- Raw RGBA path: Images are completely black
- Backend logs show the rendered data is mostly black BEFORE the PNG/raw split
- The same `rgba_data` buffer is used for both paths

## Rust Backend Code

### Internal Rendering Function (`core/api_bridge/src/lib.rs`)

```rust
async fn apply_and_render_view_state_internal(
    view_state_json: String,
    state: State<'_, BridgeState>,
    return_raw_rgba: bool
) -> BridgeResult<Vec<u8>> {
    // ... rendering logic produces frame_result ...
    
    // Pixel sampling to check for black images
    let center_x = width / 2;
    let center_y = height / 2;
    let center_idx = (center_y * width + center_x) * 4;
    
    if center_idx + 3 < frame_result.image_data.len() {
        let r = frame_result.image_data[center_idx];
        let g = frame_result.image_data[center_idx + 1];
        let b = frame_result.image_data[center_idx + 2];
        let a = frame_result.image_data[center_idx + 3];
        info!("Center pixel RGBA: [{}, {}, {}, {}]", r, g, b, a);
    }
    
    // Sample pixels to detect mostly black images
    let mut non_black_count = 0;
    let mut max_value = 0u8;
    let sample_step = 10;
    
    for y in (0..height).step_by(sample_step) {
        for x in (0..width).step_by(sample_step) {
            let idx = (y * width + x) * 4;
            if idx + 3 < frame_result.image_data.len() {
                let r = frame_result.image_data[idx];
                let g = frame_result.image_data[idx + 1];
                let b = frame_result.image_data[idx + 2];
                max_value = max_value.max(r).max(g).max(b);
                if r > 0 || g > 0 || b > 0 {
                    non_black_count += 1;
                }
            }
        }
    }
    
    let total_samples = ((height / sample_step) + 1) * ((width / sample_step) + 1);
    let non_black_percentage = (non_black_count as f32 / total_samples as f32) * 100.0;
    
    info!("Pixel sampling: {}/{} non-black pixels ({:.1}%), max value: {}", 
        non_black_count, total_samples, non_black_percentage, max_value);
    
    if non_black_percentage < 5.0 {
        warn!("Rendered image appears to be mostly black! Check intensity window settings.");
    }
    
    // Get dimensions from frame result
    let width = frame_result.dimensions[0];
    let height = frame_result.dimensions[1];
    let rgba_data = frame_result.image_data;
    
    // Choose output format based on flag
    let result = if return_raw_rgba {
        // Raw RGBA path - no PNG encoding
        info!("🚀 RAW RGBA: Skipping PNG encoding, returning raw pixel data");
        
        // Create a buffer with format: [width: u32][height: u32][rgba_data...]
        let mut raw_buffer = Vec::with_capacity(8 + rgba_data.len());
        
        // Write dimensions as little-endian u32
        raw_buffer.extend_from_slice(&width.to_le_bytes());
        raw_buffer.extend_from_slice(&height.to_le_bytes());
        
        // Append RGBA data
        raw_buffer.extend_from_slice(&rgba_data);
        
        info!("🚀 RAW RGBA: Returning {} bytes (8 byte header + {} RGBA bytes)", 
              raw_buffer.len(), rgba_data.len());
        
        raw_buffer
    } else {
        // PNG encoding path
        use image::{ImageBuffer, Rgba, ImageEncoder};
        use image::codecs::png::PngEncoder;
        use std::io::Cursor;
        
        // Create an image buffer from the RGBA data
        let img_buffer: ImageBuffer<Rgba<u8>, Vec<u8>> = 
            ImageBuffer::from_raw(width, height, rgba_data)
                .ok_or_else(|| BridgeError::Internal {
                    code: 5022,
                    details: format!("Failed to create image buffer")
                })?;
        
        // Encode to PNG with fast compression settings
        let mut png_data = Vec::new();
        let mut encoder = PngEncoder::new_with_quality(
            Cursor::new(&mut png_data),
            image::codecs::png::CompressionType::Fast,
            image::codecs::png::FilterType::NoFilter
        );
        encoder.write_image(
            img_buffer.as_raw(),
            width,
            height,
            image::ExtendedColorType::Rgba8
        ).map_err(|e| BridgeError::Internal {
            code: 5023,
            details: format!("Failed to encode PNG: {}", e)
        })?;
        
        info!("Backend: Encoded RGBA to PNG - {} bytes ({}x{})", 
              png_data.len(), width, height);
        
        png_data
    };
    
    Ok(result)
}
```

### Command Endpoints

```rust
// Raw RGBA version - returns raw pixel data with binary IPC
#[command]
async fn apply_and_render_view_state_raw(
    view_state_json: String,
    state: State<'_, BridgeState>
) -> Result<tauri::ipc::Response, BridgeError> {
    info!("🚀 RAW RGBA PATH: apply_and_render_view_state_raw called");
    
    // Call internal implementation with raw RGBA output
    let raw_data = apply_and_render_view_state_internal(view_state_json, state, true).await?;
    
    info!("🚀 RAW RGBA: Returning {} bytes of raw pixel data", raw_data.len());
    
    Ok(tauri::ipc::Response::new(raw_data))
}

// Binary PNG version - returns PNG with binary IPC
#[command]
async fn apply_and_render_view_state_binary(
    view_state_json: String,
    state: State<'_, BridgeState>
) -> Result<tauri::ipc::Response, BridgeError> {
    info!("🚀 BINARY IPC PATH: apply_and_render_view_state_binary called");
    
    // Call internal implementation with PNG output
    let png_data = apply_and_render_view_state_internal(view_state_json, state, false).await?;
    
    // Wrap in Response to signal raw binary transfer
    Ok(tauri::ipc::Response::new(png_data))
}
```

## TypeScript Frontend Code (`ui2/src/services/apiService.ts`)

### Raw RGBA Path

```typescript
if (this.useRawRGBA) {
    // Call raw RGBA command
    imageData = await this.transport.invoke<Uint8Array>(
        'apply_and_render_view_state_raw',
        { viewStateJson: JSON.stringify(declarativeViewState) }
    );
    
    // Check if this is actually raw RGBA (not PNG)
    if (imageData.length > 8) {
        const isPNG = imageData[0] === 0x89 && imageData[1] === 0x50;
        if (!isPNG) {
            isRawRGBAFormat = true;
        }
    }
}

// Later, decode raw RGBA:
if (isRawRGBAFormat && byteArray.length > 8) {
    // Raw RGBA data format: [width: u32][height: u32][rgba_data...]
    const view = new DataView(byteArray.buffer, byteArray.byteOffset);
    const width = view.getUint32(0, true);  // little-endian
    const height = view.getUint32(4, true); // little-endian
    const rgbaData = byteArray.slice(8);
    
    // Validate dimensions
    if (rgbaData.length !== width * height * 4) {
        console.error(`Invalid raw RGBA data`);
        // Fall back to PNG
    } else {
        // Optional debug brightening
        let processedRgba = rgbaData;
        if (this.debugBrighten) {
            const brightenedRgba = new Uint8ClampedArray(rgbaData.length);
            const brightenFactor = 10;
            
            for (let i = 0; i < rgbaData.length; i += 4) {
                brightenedRgba[i]   = Math.min(255, rgbaData[i] * brightenFactor);   // R
                brightenedRgba[i+1] = Math.min(255, rgbaData[i+1] * brightenFactor); // G
                brightenedRgba[i+2] = Math.min(255, rgbaData[i+2] * brightenFactor); // B
                brightenedRgba[i+3] = rgbaData[i+3];                                 // A
            }
            processedRgba = brightenedRgba;
        }
        
        // Create ImageData from raw RGBA
        const imageData = new ImageData(new Uint8ClampedArray(processedRgba), width, height);
        
        // Convert to ImageBitmap with premultiplyAlpha disabled
        bitmap = await createImageBitmap(imageData, {
            premultiplyAlpha: 'none',
            colorSpaceConversion: 'none'
        });
        
        return bitmap;
    }
}
```

### PNG Path

```typescript
// For PNG path, decode the PNG data
const blob = new Blob([byteArray], { type: 'image/png' });

try {
    return await createImageBitmap(blob);
} catch (error) {
    console.error('Failed to decode PNG data:', error);
    // Return fallback image
}
```

## Key Observations from Logs

1. **Backend produces mostly black pixels**: "1/121 non-black pixels (0.8%), max value: 245"
2. **Center pixel is black**: "Center pixel RGBA: [0, 0, 0, 255]"
3. **Data range looks correct**: "(0, 9848)" but intensity window might be wrong
4. **Same buffer for both paths**: The `rgba_data` is identical for PNG and raw RGBA

## Questions for Expert Review

1. Why would the same black pixel data render correctly when encoded as PNG but remain black as raw RGBA?
2. Could the PNG encoder be applying some transformation that makes the data visible?
3. Is the `premultiplyAlpha: 'none'` option being ignored or incorrectly applied?
4. Could there be a color space issue where PNG metadata corrects for something?
5. The backend logs show mostly black pixels - is this the real issue regardless of transfer format?