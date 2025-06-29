# Test Utilities and Infrastructure Plan

**Version:** 1.0  
**Created:** 2025-01-21  
**Purpose:** Shared test utilities, fixtures, and helpers for consistent testing

## Core Test Utilities

### 1. Rust Test Utilities Crate
**Location:** `core/test_utils/`

```toml
# core/test_utils/Cargo.toml
[package]
name = "test_utils"
version = "0.1.0"
edition = "2021"

[dependencies]
tempfile = "3.8"
tokio = { workspace = true }
wgpu = { workspace = true }
ndarray = { workspace = true }
nifti = { workspace = true }

[dev-dependencies]
# None - this is for other crates to use
```

#### Core Utilities
```rust
// core/test_utils/src/lib.rs
pub mod fixtures;
pub mod gpu;
pub mod data;
pub mod app;

use std::path::{Path, PathBuf};

/// Get path to test data directory
pub fn test_data_dir() -> PathBuf {
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    Path::new(manifest_dir)
        .parent().unwrap()
        .parent().unwrap()
        .join("test-data")
}

/// Get path to specific test file
pub fn test_data_path(filename: &str) -> PathBuf {
    test_data_dir().join(filename)
}

// src/fixtures.rs
use ndarray::Array3;

/// Create a test volume with predictable data
pub fn create_test_volume(dims: (usize, usize, usize)) -> Array3<f32> {
    let mut volume = Array3::zeros(dims);
    
    // Fill with gradient for easy verification
    for ((i, j, k), elem) in volume.indexed_iter_mut() {
        *elem = (i + j + k) as f32;
    }
    
    volume
}

/// Create a small test volume for unit tests
pub fn create_small_test_volume() -> Array3<f32> {
    create_test_volume((64, 64, 32))
}

/// Create anatomical-like test data
pub fn create_brain_phantom(size: usize) -> Array3<f32> {
    let mut volume = Array3::zeros((size, size, size));
    let center = size as f32 / 2.0;
    let radius = size as f32 / 3.0;
    
    for ((i, j, k), elem) in volume.indexed_iter_mut() {
        let dist = ((i as f32 - center).powi(2) + 
                   (j as f32 - center).powi(2) + 
                   (k as f32 - center).powi(2)).sqrt();
        
        if dist < radius {
            *elem = 1000.0 * (1.0 - dist / radius); // Brain tissue
        } else {
            *elem = 0.0; // Background
        }
    }
    
    volume
}

// src/gpu.rs
use wgpu::{Device, Queue, Instance};

/// Create a test GPU device
pub async fn create_test_device() -> (Device, Queue) {
    let instance = Instance::new(wgpu::InstanceDescriptor {
        backends: wgpu::Backends::all(),
        dx12_shader_compiler: Default::default(),
    });
    
    let adapter = instance
        .request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::default(),
            compatible_surface: None,
            force_fallback_adapter: false,
        })
        .await
        .expect("Failed to find adapter");
    
    adapter
        .request_device(
            &wgpu::DeviceDescriptor {
                features: wgpu::Features::empty(),
                limits: wgpu::Limits::default(),
                label: Some("Test Device"),
            },
            None,
        )
        .await
        .expect("Failed to create device")
}

/// Create a test render target
pub fn create_test_render_target(device: &Device, width: u32, height: u32) -> wgpu::Texture {
    device.create_texture(&wgpu::TextureDescriptor {
        label: Some("Test Render Target"),
        size: wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8UnormSrgb,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    })
}

// src/app.rs
use tauri::test::{MockRuntime, mock_builder};

/// Create a test Tauri app
pub fn create_test_app() -> tauri::App<MockRuntime> {
    mock_builder()
        .plugin(tauri_plugin_api_bridge::init())
        .build(tauri::generate_context!())
        .expect("Failed to build test app")
}
```

### 2. TypeScript Test Utilities
**Location:** `packages/test-utils/`

```typescript
// packages/test-utils/src/index.ts
export * from './fixtures';
export * from './mocks';
export * from './helpers';
export * from './components';

// src/fixtures.ts
import type { Volume, Layer, VolumeHandle } from '@brainflow/api';

export const mockVolume: Volume = {
  handle: 1,
  dims: [256, 256, 128],
  voxelSize: [1.0, 1.0, 1.5],
  affine: [
    [1, 0, 0, -128],
    [0, 1, 0, -128],
    [0, 0, 1.5, -96],
    [0, 0, 0, 1]
  ],
  dataType: 'float32',
  name: 'test_volume.nii.gz'
};

export const mockLayer: Layer = {
  id: 'layer-1',
  name: 'Test Layer',
  volumeHandle: 1,
  opacity: 1.0,
  visible: true,
  colormap: 'grayscale',
  windowLevel: 1000,
  windowWidth: 400
};

export function createMockVolume(overrides?: Partial<Volume>): Volume {
  return { ...mockVolume, ...overrides };
}

// src/mocks.ts
import { vi } from 'vitest';

export const mockBridgeAPI = {
  loadVolume: vi.fn(() => Promise.resolve({ handle: 1, dims: [256, 256, 128] })),
  renderFrame: vi.fn(() => Promise.resolve()),
  setFrameParams: vi.fn(() => Promise.resolve()),
  requestLayerGpuResources: vi.fn(() => Promise.resolve({ textureId: 1 })),
  getVolumeInfo: vi.fn(() => Promise.resolve(mockVolume))
};

export function mockTauriAPI() {
  (window as any).__TAURI__ = {
    invoke: vi.fn((cmd: string, args: any) => {
      const [plugin, method] = cmd.split('|');
      if (plugin === 'plugin:api_bridge' && mockBridgeAPI[method]) {
        return mockBridgeAPI[method](args);
      }
      return Promise.reject(new Error(`Unknown command: ${cmd}`));
    })
  };
}

// src/helpers.ts
import { render as svelteRender } from '@testing-library/svelte';
import type { ComponentProps } from 'svelte';

export function renderWithContext<T extends Record<string, any>>(
  Component: any,
  props?: ComponentProps<T>,
  options?: any
) {
  // Add any global context providers here
  return svelteRender(Component, { props, ...options });
}

export async function waitForGPU() {
  // Wait for WebGPU operations to complete
  await new Promise(resolve => requestAnimationFrame(resolve));
}

export function createMockCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  
  // Mock WebGPU context
  const mockContext = {
    configure: vi.fn(),
    getCurrentTexture: vi.fn(() => ({ createView: vi.fn() })),
    presentationFormat: 'bgra8unorm'
  };
  
  canvas.getContext = vi.fn((type: string) => {
    if (type === 'webgpu') return mockContext;
    return canvas.getContext.call(canvas, type);
  });
  
  return canvas;
}

// src/components.ts
import { writable } from 'svelte/store';

export function createTestStores() {
  const volumeStore = writable(mockVolume);
  const layerStore = writable([mockLayer]);
  const viewStore = writable({
    axialSlice: 64,
    coronalSlice: 128,
    sagittalSlice: 128
  });
  
  return { volumeStore, layerStore, viewStore };
}
```

### 3. E2E Test Helpers
**Location:** `ui/e2e/helpers/`

```typescript
// ui/e2e/helpers/index.ts
import { Page, expect } from '@playwright/test';
import path from 'path';

export async function mockDialog(page: Page, filePath: string) {
  // Mock Tauri file dialog
  await page.evaluateOnNewDocument((path) => {
    (window as any).__TAURI_DIALOG_MOCK__ = {
      open: async () => path
    };
  }, filePath);
}

export async function loadTestVolume(page: Page, filename: string) {
  const testFile = path.join(__dirname, '../../test-data', filename);
  await mockDialog(page, testFile);
  await page.click('[data-testid="load-volume-btn"]');
  await page.waitForSelector('[data-testid="volume-loaded"]');
}

export async function waitForRendering(page: Page) {
  // Wait for GPU rendering to complete
  await page.waitForFunction(() => {
    const canvases = document.querySelectorAll('canvas');
    return Array.from(canvases).every(canvas => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return false;
      const imageData = ctx.getImageData(0, 0, 1, 1);
      return imageData.data.some(v => v > 0);
    });
  });
}

export async function captureCanvasScreenshot(page: Page, canvasId: string) {
  const canvas = await page.locator(`#${canvasId}`);
  const screenshot = await canvas.screenshot();
  return screenshot;
}

export async function getSlicePosition(page: Page, view: 'axial' | 'coronal' | 'sagittal') {
  const value = await page.inputValue(`[data-testid="${view}-slice"]`);
  return parseInt(value, 10);
}

export async function setSlicePosition(
  page: Page, 
  view: 'axial' | 'coronal' | 'sagittal', 
  position: number
) {
  await page.fill(`[data-testid="${view}-slice"]`, position.toString());
  await page.press(`[data-testid="${view}-slice"]`, 'Enter');
}
```

### 4. Performance Test Utilities
**Location:** `tools/perf-utils/`

```typescript
// tools/perf-utils/src/index.ts
export class PerformanceProfiler {
  private marks: Map<string, number> = new Map();
  private measures: Map<string, number[]> = new Map();
  
  mark(name: string) {
    this.marks.set(name, performance.now());
  }
  
  measure(name: string, startMark: string, endMark?: string) {
    const start = this.marks.get(startMark);
    const end = endMark ? this.marks.get(endMark) : performance.now();
    
    if (!start || !end) {
      throw new Error(`Missing marks: ${startMark} or ${endMark}`);
    }
    
    const duration = end - start;
    const measures = this.measures.get(name) || [];
    measures.push(duration);
    this.measures.set(name, measures);
    
    return duration;
  }
  
  getStats(name: string) {
    const measures = this.measures.get(name) || [];
    if (measures.length === 0) return null;
    
    const sorted = [...measures].sort((a, b) => a - b);
    return {
      min: sorted[0],
      max: sorted[sorted.length - 1],
      mean: measures.reduce((a, b) => a + b, 0) / measures.length,
      median: sorted[Math.floor(sorted.length / 2)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)],
      count: measures.length
    };
  }
  
  report() {
    const report: Record<string, any> = {};
    for (const [name, _] of this.measures) {
      report[name] = this.getStats(name);
    }
    return report;
  }
}

export async function profileGPUOperation<T>(
  name: string,
  operation: () => Promise<T>
): Promise<{ result: T; timing: number }> {
  const start = performance.now();
  const result = await operation();
  
  // Ensure GPU operations complete
  if ('gpu' in navigator) {
    await (navigator as any).gpu.queue.onSubmittedWorkDone();
  }
  
  const timing = performance.now() - start;
  return { result, timing };
}
```

### 5. Visual Regression Utilities
**Location:** `tools/visual-regression/`

```typescript
// tools/visual-regression/src/index.ts
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import fs from 'fs/promises';
import path from 'path';

export interface ComparisonResult {
  match: boolean;
  difference: number;
  diffImage?: Buffer;
}

export async function compareImages(
  actualPath: string,
  expectedPath: string,
  threshold = 0.1
): Promise<ComparisonResult> {
  const [actual, expected] = await Promise.all([
    fs.readFile(actualPath),
    fs.readFile(expectedPath)
  ]);
  
  const actualPNG = PNG.sync.read(actual);
  const expectedPNG = PNG.sync.read(expected);
  
  if (actualPNG.width !== expectedPNG.width || actualPNG.height !== expectedPNG.height) {
    return {
      match: false,
      difference: 1,
      diffImage: undefined
    };
  }
  
  const diff = new PNG({ width: actualPNG.width, height: actualPNG.height });
  const numDiffPixels = pixelmatch(
    actualPNG.data,
    expectedPNG.data,
    diff.data,
    actualPNG.width,
    actualPNG.height,
    { threshold }
  );
  
  const difference = numDiffPixels / (actualPNG.width * actualPNG.height);
  
  return {
    match: difference < 0.01, // Less than 1% different
    difference,
    diffImage: PNG.sync.write(diff)
  };
}

export async function updateBaseline(
  actualPath: string,
  baselinePath: string
) {
  await fs.copyFile(actualPath, baselinePath);
}
```

## Test Data Generation

### Generate Test NIfTI Files
```python
# scripts/generate_test_data.py
import numpy as np
import nibabel as nib
import os

def create_test_nifti(filename, shape, pattern='gradient'):
    """Create a test NIfTI file with known patterns"""
    
    if pattern == 'gradient':
        # Linear gradient
        data = np.mgrid[:shape[0], :shape[1], :shape[2]][0].astype(np.float32)
    elif pattern == 'sphere':
        # Sphere in center
        center = np.array(shape) // 2
        x, y, z = np.ogrid[:shape[0], :shape[1], :shape[2]]
        r = np.sqrt((x - center[0])**2 + (y - center[1])**2 + (z - center[2])**2)
        data = (r < min(shape) // 3).astype(np.float32) * 1000
    elif pattern == 'checkerboard':
        # 3D checkerboard
        data = np.zeros(shape, dtype=np.float32)
        size = 8
        for i in range(0, shape[0], size*2):
            for j in range(0, shape[1], size*2):
                for k in range(0, shape[2], size*2):
                    data[i:i+size, j:j+size, k:k+size] = 1000
    
    # Create NIfTI image
    affine = np.eye(4)
    img = nib.Nifti1Image(data, affine)
    
    # Save
    output_dir = '../test-data/generated'
    os.makedirs(output_dir, exist_ok=True)
    nib.save(img, os.path.join(output_dir, filename))

if __name__ == '__main__':
    # Small files for unit tests
    create_test_nifti('gradient_64x64x32.nii.gz', (64, 64, 32), 'gradient')
    create_test_nifti('sphere_64x64x32.nii.gz', (64, 64, 32), 'sphere')
    
    # Medium files for integration tests
    create_test_nifti('brain_256x256x128.nii.gz', (256, 256, 128), 'sphere')
    create_test_nifti('checker_256x256x128.nii.gz', (256, 256, 128), 'checkerboard')
    
    # Large file for performance tests
    create_test_nifti('large_512x512x256.nii.gz', (512, 512, 256), 'gradient')
```

## CI/CD Test Integration

### Test Stage Gates
```yaml
# .github/workflows/quality-gates.yml
name: Quality Gates

on:
  pull_request:
    types: [opened, synchronize]

jobs:
  coverage-gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Check coverage
        run: |
          COVERAGE=$(cargo tarpaulin --print-summary | grep "Coverage" | awk '{print $2}' | sed 's/%//')
          if (( $(echo "$COVERAGE < 70" | bc -l) )); then
            echo "Coverage $COVERAGE% is below 70% threshold"
            exit 1
          fi

  performance-gate:
    runs-on: ubuntu-latest
    steps:
      - name: Run benchmarks
        run: cargo bench --bench gpu_benchmark -- --save-baseline new
        
      - name: Compare with baseline
        run: |
          cargo bench --bench gpu_benchmark -- --baseline main
          # Fail if regression > 10%
```

---

This comprehensive test infrastructure provides all the utilities, helpers, and patterns needed to effectively test the brainflow2 application during the technical debt reduction process. Each test type has dedicated utilities to make writing tests easier and more consistent.