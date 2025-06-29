# E2E Testing & Debugging Guide for Claude

This guide explains how to use the E2E testing framework to run the Brainflow2 app, test features, and debug issues using screenshots and automated validation.

## Quick Start

```bash
# From the e2e directory:
./setup-e2e.sh    # First time setup
./run-e2e.sh      # Run all tests
```

## Test Structure

### 1. App Launch Tests (`tests/app-launch.spec.ts`)
- Verifies Tauri app launches successfully
- Checks GPU initialization
- Validates UI elements are present

### 2. Volume Loading Tests (`tests/volume-loading.spec.ts`)
- Tests NIFTI file loading
- Validates multi-volume overlay functionality
- Captures screenshots of loaded volumes

### 3. Rendering Tests (`tests/rendering.spec.ts`)
- Validates GPU rendering output
- Tests colormap changes
- Checks opacity adjustments
- Verifies crosshair rendering
- Tests view synchronization

## Debugging Workflows

### 1. Visual Debugging
```bash
# Run tests with UI to see what's happening
./run-e2e.sh --ui

# Run in debug mode (opens browser devtools)
./run-e2e.sh --debug
```

### 2. Screenshot Analysis
Screenshots are saved in `e2e/screenshots/` with descriptive names:
- `app-launched.png` - Initial app state
- `volume-loaded.png` - After loading a volume
- `colormap-viridis.png` - After colormap change
- `multi-volume-overlay.png` - Multiple volumes loaded

### 3. Specific Test Execution
```bash
# Run only rendering tests
npx playwright test rendering.spec.ts

# Run a specific test
npx playwright test -g "should render volume with correct texture mapping"
```

## Key Testing Utilities

### `validateGPURendering(screenshot)`
Analyzes a screenshot to determine if GPU rendering is working:
- Checks for non-black pixels
- Calculates average brightness
- Provides color channel statistics

### `loadTestVolume(page, path)`
Loads a NIFTI file into the app using multiple methods:
1. File input element (if available)
2. Menu/toolbar interaction
3. Direct Tauri command invocation

### `captureScreenshot(target, name)`
Captures and saves screenshots for visual debugging and comparison.

## Common Issues & Solutions

### Issue: Tests timeout waiting for app
**Solution**: Increase timeout in `playwright.config.ts`:
```typescript
webServer: {
  timeout: 180 * 1000, // 3 minutes
}
```

### Issue: GPU rendering shows black screen
**Debug steps**:
1. Check console logs for GPU initialization errors
2. Use `validateGPURendering` to analyze pixel data
3. Verify texture coordinates are correct

### Issue: Volume doesn't load
**Debug steps**:
1. Check if test data exists at expected path
2. Look for errors in console logs
3. Try loading via different methods (UI vs Tauri command)

## Adding New Tests

### Template for new rendering test:
```typescript
test('should test new feature', async ({ page }) => {
  await waitForTauriApp(page);
  
  // Load test volume
  const testVolume = path.join(__dirname, '../../test-data/unit/toy_t1w.nii.gz');
  await loadTestVolume(page, testVolume);
  
  // Perform action
  // ... your test actions ...
  
  // Capture result
  await captureScreenshot(page, 'feature-result');
  
  // Validate
  const validation = await validateGPURendering(await page.screenshot());
  expect(validation.hasContent).toBeTruthy();
});
```

## Integration with Claude Workflow

When debugging issues:

1. **Run specific test**:
   ```bash
   npx playwright test rendering.spec.ts -g "texture mapping"
   ```

2. **Analyze screenshots**:
   - Compare before/after screenshots
   - Use `validateGPURendering` for pixel analysis

3. **Check logs**:
   ```typescript
   const logs = await page.evaluate(() => (window as any).__consoleLogs);
   ```

4. **Modify and re-test**:
   - Make code changes
   - Re-run specific test
   - Verify fix with screenshots

## Advanced Debugging

### Trace Recording
```bash
# Record trace for debugging
npx playwright test --trace on

# View trace
npx playwright show-trace trace.zip
```

### Performance Testing
Use `getRenderStats()` to monitor:
- FPS
- Frame time
- GPU memory usage

### Visual Regression Testing
```bash
# Update baseline screenshots
./run-e2e.sh --update-snapshots

# Run with snapshot comparison
./run-e2e.sh
```

## Tips for Effective Debugging

1. **Start with app-launch test** to ensure basic functionality
2. **Use screenshot comparisons** to detect visual changes
3. **Check console logs** for Tauri command responses
4. **Validate GPU output** with pixel analysis utilities
5. **Run tests in headed mode** (--ui) to see interactions

This framework enables systematic debugging of rendering issues, texture coordinate problems, and UI integration challenges.