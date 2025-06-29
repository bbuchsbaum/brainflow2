# Critical Feature Test Plan

**Version:** 1.0  
**Created:** 2025-01-21  
**Purpose:** Detailed test requirements for major features during technical debt reduction

## Feature 1: NIfTI Image Loading and Display

### Current State
- Loader exists but returns empty data
- No tests for loading pipeline
- Tauri bridge commands untested

### Test Requirements

#### Unit Tests (Rust)
```rust
// core/loaders/src/nifti_loader.rs
#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_load_valid_nifti() {
        let path = test_data_path("toy_t1w.nii.gz");
        let loader = NiftiLoader::new();
        let result = loader.load(&path);
        
        assert!(result.is_ok());
        let volume = result.unwrap();
        assert_eq!(volume.dims(), (64, 64, 32));
        assert_eq!(volume.data.len(), 64 * 64 * 32);
    }
    
    #[test]
    fn test_load_missing_file() {
        let loader = NiftiLoader::new();
        let result = loader.load(Path::new("/nonexistent.nii"));
        
        assert!(result.is_err());
        assert_eq!(result.unwrap_err().kind(), ErrorKind::FileNotFound);
    }
    
    #[test]
    fn test_load_corrupted_file() {
        let path = test_data_path("corrupted.nii.gz");
        let loader = NiftiLoader::new();
        let result = loader.load(&path);
        
        assert!(result.is_err());
        assert_eq!(result.unwrap_err().kind(), ErrorKind::InvalidFormat);
    }
    
    #[test]
    fn test_affine_transformation() {
        let volume = load_test_volume();
        let affine = volume.affine();
        
        // Test voxel to world coordinates
        let voxel = Vector3::new(32.0, 32.0, 16.0);
        let world = affine.transform_point(&voxel);
        assert_relative_eq!(world.x, 0.0, epsilon = 0.001);
    }
}
```

#### Integration Tests (Rust)
```rust
// src-tauri/tests/load_volume_integration.rs
#[test]
async fn test_load_volume_command() {
    let app = create_test_app().await;
    let path = test_data_path("toy_t1w.nii.gz");
    
    // Call Tauri command
    let result: LoadResult = app
        .invoke("plugin:api_bridge|load_volume", json!({
            "path": path.to_str()
        }))
        .await;
    
    assert!(result.is_ok());
    let handle = result.unwrap();
    assert!(handle.id > 0);
    assert_eq!(handle.dims, [64, 64, 32]);
}

#[test]
async fn test_volume_registry_storage() {
    let app = create_test_app().await;
    
    // Load volume
    let handle = load_test_volume(&app).await;
    
    // Verify stored in registry
    let info: VolumeInfo = app
        .invoke("plugin:api_bridge|get_volume_info", json!({
            "handle": handle
        }))
        .await
        .unwrap();
    
    assert_eq!(info.handle, handle);
    assert!(info.memory_size > 0);
}
```

#### E2E Tests (TypeScript)
```typescript
// ui/e2e/load-volume.spec.ts
import { test, expect } from '@playwright/test';
import { mockDialog } from './helpers';

test.describe('Volume Loading', () => {
  test('should load and display NIfTI file', async ({ page }) => {
    await page.goto('/');
    
    // Mock file dialog to return test file
    await mockDialog(page, 'test-data/toy_t1w.nii.gz');
    
    // Click load button
    await page.click('[data-testid="load-volume-btn"]');
    
    // Wait for volume to load
    await page.waitForSelector('[data-testid="volume-view"]');
    
    // Verify all three views rendered
    const canvases = await page.$$('canvas');
    expect(canvases).toHaveLength(3);
    
    // Verify slice controls appear
    await expect(page.locator('[data-testid="slice-slider"]')).toBeVisible();
    
    // Take screenshot for visual regression
    await expect(page).toHaveScreenshot('volume-loaded.png');
  });
  
  test('should handle loading errors gracefully', async ({ page }) => {
    await page.goto('/');
    
    // Mock dialog to return invalid file
    await mockDialog(page, 'test-data/not-a-nifti.txt');
    
    await page.click('[data-testid="load-volume-btn"]');
    
    // Verify error message appears
    await expect(page.locator('[data-testid="error-toast"]')).toContainText(
      'Failed to load volume'
    );
    
    // Verify app doesn't crash
    await expect(page.locator('[data-testid="app-header"]')).toBeVisible();
  });
});
```

## Feature 2: Multi-View Rendering (Axial/Coronal/Sagittal)

### Current State
- Single canvas exists but doesn't render
- No shader pipeline
- No view synchronization

### Test Requirements

#### Unit Tests (Rust)
```rust
// core/render_loop/src/views.rs
#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_slice_extraction_axial() {
        let volume = create_test_volume_3d();
        let slice = extract_slice(&volume, Plane::Axial, 16);
        
        assert_eq!(slice.dims(), (64, 64));
        assert_eq!(slice.data.len(), 64 * 64);
        // Verify correct data extracted
        assert_eq!(slice.data[0], volume.data[16 * 64 * 64]);
    }
    
    #[test]
    fn test_slice_extraction_coronal() {
        let volume = create_test_volume_3d();
        let slice = extract_slice(&volume, Plane::Coronal, 32);
        
        assert_eq!(slice.dims(), (64, 32));
        // Verify correct orientation
    }
    
    #[test]
    fn test_slice_extraction_sagittal() {
        let volume = create_test_volume_3d();
        let slice = extract_slice(&volume, Plane::Sagittal, 32);
        
        assert_eq!(slice.dims(), (64, 32));
        // Verify correct orientation
    }
    
    #[test]
    fn test_slice_bounds_checking() {
        let volume = create_test_volume_3d(); // 64x64x32
        
        // Test out of bounds
        let result = try_extract_slice(&volume, Plane::Axial, 50);
        assert!(result.is_err());
        
        // Test edge cases
        let slice = extract_slice(&volume, Plane::Axial, 31);
        assert!(slice.data.len() > 0);
    }
}

// core/render_loop/src/shader_pipeline.rs
#[cfg(test)]
mod tests {
    #[test]
    fn test_shader_compilation() {
        let device = create_test_device();
        let vertex_shader = compile_shader(&device, VERTEX_SHADER_SRC, ShaderStage::Vertex);
        let fragment_shader = compile_shader(&device, FRAGMENT_SHADER_SRC, ShaderStage::Fragment);
        
        assert!(vertex_shader.is_ok());
        assert!(fragment_shader.is_ok());
    }
    
    #[test]
    fn test_pipeline_creation() {
        let device = create_test_device();
        let pipeline = create_render_pipeline(&device);
        
        assert!(pipeline.is_ok());
    }
}
```

#### Integration Tests (TypeScript)
```typescript
// packages/ui/tests/multi-view.test.ts
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import VolumeView from '../src/lib/components/VolumeView.svelte';
import { volumeStore } from '../src/lib/stores/volumeStore';

describe('Multi-View Rendering', () => {
  it('should create three canvases with correct IDs', () => {
    const { container } = render(VolumeView);
    
    const axialCanvas = container.querySelector('#axial-canvas');
    const coronalCanvas = container.querySelector('#coronal-canvas');
    const sagittalCanvas = container.querySelector('#sagittal-canvas');
    
    expect(axialCanvas).toBeTruthy();
    expect(coronalCanvas).toBeTruthy();
    expect(sagittalCanvas).toBeTruthy();
  });
  
  it('should synchronize slice navigation across views', async () => {
    const { getByTestId } = render(VolumeView);
    
    // Mock volume loaded
    volumeStore.setVolume({
      handle: 1,
      dims: [256, 256, 128],
      currentSlices: { axial: 64, coronal: 128, sagittal: 128 }
    });
    
    // Change axial slice
    const axialSlider = getByTestId('axial-slice-slider');
    fireEvent.input(axialSlider, { target: { value: '80' } });
    
    // Verify crosshairs updated in other views
    const coronalCrosshair = getByTestId('coronal-crosshair');
    const sagittalCrosshair = getByTestId('sagittal-crosshair');
    
    expect(coronalCrosshair.style.top).toBe('80px');
    expect(sagittalCrosshair.style.top).toBe('80px');
  });
  
  it('should handle view resize correctly', async () => {
    const { container } = render(VolumeView);
    const resizeObserverCallback = vi.fn();
    
    // Mock ResizeObserver
    global.ResizeObserver = vi.fn().mockImplementation((callback) => ({
      observe: () => callback([{ contentRect: { width: 512, height: 512 } }]),
      disconnect: () => {}
    }));
    
    // Trigger resize
    window.dispatchEvent(new Event('resize'));
    
    // Verify canvases resized
    const canvases = container.querySelectorAll('canvas');
    canvases.forEach(canvas => {
      expect(canvas.width).toBe(512);
      expect(canvas.height).toBe(512);
    });
  });
});
```

#### E2E Tests
```typescript
// ui/e2e/multi-view-sync.spec.ts
test('should synchronize all three views when navigating', async ({ page }) => {
  // Load test volume
  await loadTestVolume(page, 'brain_t1.nii.gz');
  
  // Get initial slice positions
  const axialSlice = await page.inputValue('[data-testid="axial-slice"]');
  
  // Click on coronal view to change position
  const coronalCanvas = await page.locator('#coronal-canvas');
  await coronalCanvas.click({ position: { x: 200, y: 150 } });
  
  // Verify all views updated
  await expect(page.locator('[data-testid="axial-crosshair"]')).toHaveCSS(
    'transform',
    /translate.*200.*150/
  );
  
  // Verify slice numbers updated
  await expect(page.locator('[data-testid="sagittal-slice"]')).toHaveValue('200');
  
  // Screenshot for visual verification
  await expect(page).toHaveScreenshot('three-view-sync.png');
});
```

## Feature 3: WebGPU Rendering Pipeline

### Current State
- No shader compilation
- No render pipeline
- GPU resources not utilized

### Test Requirements

#### Unit Tests (Rust)
```rust
// core/render_loop/src/gpu_resources.rs
#[cfg(test)]
mod tests {
    #[test]
    fn test_texture_creation() {
        let device = create_test_device();
        let texture = create_slice_texture(&device, 256, 256);
        
        assert!(texture.is_ok());
        let tex = texture.unwrap();
        assert_eq!(tex.size().width, 256);
        assert_eq!(tex.size().height, 256);
    }
    
    #[test]
    fn test_texture_upload() {
        let device = create_test_device();
        let queue = device.create_queue();
        let texture = create_slice_texture(&device, 64, 64).unwrap();
        
        let data = vec![128u8; 64 * 64];
        let result = upload_texture_data(&queue, &texture, &data);
        
        assert!(result.is_ok());
    }
    
    #[test]
    fn test_texture_atlas_management() {
        let mut atlas = TextureAtlas::new(&device, 2048, 2048);
        
        // Allocate regions
        let region1 = atlas.allocate(256, 256);
        let region2 = atlas.allocate(512, 512);
        
        assert!(region1.is_some());
        assert!(region2.is_some());
        assert_ne!(region1.unwrap().offset, region2.unwrap().offset);
        
        // Test fragmentation handling
        atlas.free(region1.unwrap().id);
        let region3 = atlas.allocate(256, 256);
        assert_eq!(region3.unwrap().offset, region1.unwrap().offset);
    }
}

// core/render_loop/src/render_pipeline.rs
#[cfg(test)]
mod tests {
    #[test]
    fn test_render_pass_creation() {
        let device = create_test_device();
        let pipeline = create_render_pipeline(&device).unwrap();
        let target = create_render_target(&device, 512, 512).unwrap();
        
        let render_pass = create_render_pass(&device, &pipeline, &target);
        assert!(render_pass.is_ok());
    }
    
    #[test]
    fn test_uniform_buffer_updates() {
        let device = create_test_device();
        let uniform_buffer = create_uniform_buffer(&device);
        
        let uniforms = SliceUniforms {
            mvp_matrix: Matrix4::identity(),
            window_level: 1000.0,
            window_width: 400.0,
        };
        
        let result = update_uniforms(&device, &uniform_buffer, &uniforms);
        assert!(result.is_ok());
    }
}
```

#### Performance Tests
```rust
// benches/gpu_benchmark.rs
use criterion::{criterion_group, criterion_main, Criterion};

fn texture_upload_benchmark(c: &mut Criterion) {
    let device = create_device();
    let queue = device.create_queue();
    
    c.bench_function("texture_upload_256x256", |b| {
        let texture = create_slice_texture(&device, 256, 256).unwrap();
        let data = vec![128u8; 256 * 256];
        
        b.iter(|| {
            upload_texture_data(&queue, &texture, &data).unwrap();
        });
    });
}

fn render_frame_benchmark(c: &mut Criterion) {
    let ctx = create_render_context();
    
    c.bench_function("render_single_frame", |b| {
        b.iter(|| {
            ctx.render_frame(SliceParams::default()).unwrap();
        });
    });
}

criterion_group!(benches, texture_upload_benchmark, render_frame_benchmark);
criterion_main!(benches);
```

## Feature 4: Layer Management

### Current State
- Layer store exists but not connected
- No GPU resource management for layers
- No opacity/blending implementation

### Test Requirements

#### Unit Tests (TypeScript)
```typescript
// packages/ui/src/lib/stores/layerStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { layerStore } from './layerStore';

describe('layerStore', () => {
  beforeEach(() => {
    layerStore.reset();
  });
  
  it('should add layers in correct order', () => {
    const layer1 = { id: '1', name: 'T1', volumeHandle: 1 };
    const layer2 = { id: '2', name: 'Overlay', volumeHandle: 2 };
    
    layerStore.addLayer(layer1);
    layerStore.addLayer(layer2);
    
    const layers = get(layerStore);
    expect(layers).toHaveLength(2);
    expect(layers[0]).toEqual(layer1);
    expect(layers[1]).toEqual(layer2);
  });
  
  it('should update layer properties', () => {
    const layer = { id: '1', name: 'T1', opacity: 1.0, visible: true };
    layerStore.addLayer(layer);
    
    layerStore.updateLayer('1', { opacity: 0.5, visible: false });
    
    const layers = get(layerStore);
    expect(layers[0].opacity).toBe(0.5);
    expect(layers[0].visible).toBe(false);
  });
  
  it('should reorder layers', () => {
    layerStore.addLayer({ id: '1', name: 'Layer 1' });
    layerStore.addLayer({ id: '2', name: 'Layer 2' });
    layerStore.addLayer({ id: '3', name: 'Layer 3' });
    
    layerStore.reorderLayers(['3', '1', '2']);
    
    const layers = get(layerStore);
    expect(layers[0].id).toBe('3');
    expect(layers[1].id).toBe('1');
    expect(layers[2].id).toBe('2');
  });
  
  it('should handle layer removal', () => {
    layerStore.addLayer({ id: '1', name: 'Layer 1' });
    layerStore.addLayer({ id: '2', name: 'Layer 2' });
    
    layerStore.removeLayer('1');
    
    const layers = get(layerStore);
    expect(layers).toHaveLength(1);
    expect(layers[0].id).toBe('2');
  });
});
```

#### Integration Tests (Rust)
```rust
// src-tauri/tests/layer_management.rs
#[test]
async fn test_multi_layer_rendering() {
    let app = create_test_app().await;
    
    // Load base volume
    let base_handle = load_test_volume(&app, "brain_t1.nii.gz").await;
    
    // Load overlay
    let overlay_handle = load_test_volume(&app, "activation_map.nii.gz").await;
    
    // Set up layers
    let result: Result<()> = app
        .invoke("plugin:api_bridge|set_layers", json!({
            "layers": [
                { "handle": base_handle, "opacity": 1.0 },
                { "handle": overlay_handle, "opacity": 0.7 }
            ]
        }))
        .await;
    
    assert!(result.is_ok());
    
    // Render frame with both layers
    let frame_result: Result<()> = app
        .invoke("plugin:api_bridge|render_frame", json!({
            "plane": "axial",
            "slice": 50
        }))
        .await;
    
    assert!(frame_result.is_ok());
}
```

## Feature 5: State Management

### Current State
- Zustand stores exist but incomplete
- No proper error handling
- State not synced with Rust backend

### Test Requirements

#### Unit Tests (TypeScript)
```typescript
// packages/ui/src/lib/stores/volumeStore.test.ts
describe('volumeStore', () => {
  it('should handle volume loading states', async () => {
    const store = useVolumeStore.getState();
    
    // Start loading
    store.setLoading(true);
    expect(store.isLoading).toBe(true);
    
    // Set volume
    store.setVolume({
      handle: 1,
      dims: [256, 256, 128],
      voxelSize: [1, 1, 1],
      affine: identityMatrix()
    });
    
    expect(store.isLoading).toBe(false);
    expect(store.currentVolume).toBeDefined();
    expect(store.error).toBeNull();
  });
  
  it('should handle loading errors', () => {
    const store = useVolumeStore.getState();
    
    store.setError('Failed to load volume: Invalid format');
    
    expect(store.error).toBe('Failed to load volume: Invalid format');
    expect(store.isLoading).toBe(false);
    expect(store.currentVolume).toBeNull();
  });
  
  it('should update slice positions', () => {
    const store = useVolumeStore.getState();
    store.setVolume(mockVolume);
    
    store.setSlice('axial', 64);
    store.setSlice('coronal', 128);
    store.setSlice('sagittal', 96);
    
    expect(store.slices.axial).toBe(64);
    expect(store.slices.coronal).toBe(128);
    expect(store.slices.sagittal).toBe(96);
  });
});
```

## Test Automation Setup

### Continuous Integration
```yaml
# .github/workflows/test.yml
name: Test Suite

on: [push, pull_request]

jobs:
  rust-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: dtolnay/rust-toolchain@stable
      - uses: Swatinem/rust-cache@v2
      
      - name: Run unit tests
        run: cargo test --workspace
        
      - name: Run integration tests
        run: cargo test --workspace --features integration
        
      - name: Generate coverage
        run: |
          cargo install cargo-tarpaulin
          cargo tarpaulin --out Xml
      
      - name: Upload coverage
        uses: codecov/codecov-action@v3

  typescript-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v3
      
      - name: Install dependencies
        run: pnpm install
        
      - name: Run tests
        run: pnpm test:unit
        
      - name: Generate coverage
        run: pnpm test:coverage

  e2e-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: pnpm/action-setup@v2
      
      - name: Install Tauri dependencies
        run: |
          sudo apt-get update
          sudo apt-get install -y libgtk-3-dev webkit2gtk-4.0
          
      - name: Build app
        run: |
          pnpm install
          pnpm build
          
      - name: Run E2E tests
        run: pnpm test:e2e
```

### Test Running Scripts
```json
// package.json
{
  "scripts": {
    "test": "pnpm test:unit && cargo test",
    "test:unit": "vitest run",
    "test:unit:watch": "vitest",
    "test:integration": "cargo test --features integration",
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui",
    "test:coverage": "vitest run --coverage",
    "test:bench": "cargo bench",
    "test:all": "pnpm test && pnpm test:integration && pnpm test:e2e"
  }
}
```

## Success Criteria

### For Each Feature
- [ ] Unit test coverage > 80%
- [ ] Integration tests passing
- [ ] E2E journey tests passing
- [ ] Performance benchmarks established
- [ ] No regression in existing tests

### Overall
- [ ] All critical paths tested
- [ ] CI pipeline green
- [ ] Test execution < 5 minutes
- [ ] Coverage trending upward
- [ ] Zero flaky tests

---

This comprehensive test plan ensures that as we fix technical debt, we build confidence through testing at every level. Each feature has specific test requirements that must be met before considering the debt item resolved.