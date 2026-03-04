<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-10 -->

# e2e - End-to-End Test Suite

## Purpose
Automated end-to-end testing suite using Playwright to validate the complete Brainflow2 application functionality. Tests cover app launch, volume loading, rendering pipelines, UI interactions, multi-volume overlays, colormap rendering, atlas systems, and security validation. Designed for both local development and CI/CD integration.

## Key Files
| File | Description |
|------|-------------|
| `package.json` | NPM package with Playwright dependencies and test scripts |
| `playwright.config.ts` | Playwright configuration (browsers, timeouts, screenshots, traces) |
| `run-e2e.sh` | Script to run end-to-end tests with proper setup |
| `setup-e2e.sh` | Initial setup script for E2E test environment |
| `README.md` | E2E testing documentation and approach |
| `DEBUG_GUIDE.md` | Debugging guide for failing E2E tests |
| `.gitignore` | Git ignore patterns for test artifacts |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `tests/` | Test specification files (10+ spec files covering different features) |
| `utils/` | Test utilities and helpers (Tauri helpers, GPU validation) |

### Test Files (tests/)
| File | Purpose |
|------|---------|
| `app-launch.spec.ts` | Basic app launch and initialization tests |
| `volume-loading.spec.ts` | Volume loading and display validation |
| `rendering.spec.ts` | Rendering pipeline validation |
| `integration-check.spec.ts` | Integration smoke tests |
| `multi-volume-overlay.spec.ts` | Multi-volume overlay functionality |
| `orthogonal-view-gpu.spec.ts` | GPU-based orthogonal view tests |
| `tree-browser-refactored.spec.ts` | File browser tree component tests |
| `colormap-rendering.spec.ts` | Colormap system rendering tests |
| `atlas-menu-system.spec.ts` | Atlas menu and selection tests |
| `security-validation.spec.ts` | Security and permission validation |

### Utilities (utils/)
| File | Purpose |
|------|---------|
| `tauri-helpers.ts` | Tauri-specific test utilities for IPC and app control |
| `gpu-validation.ts` | WebGPU rendering validation and screenshot comparison |

## For AI Agents

### Working In This Directory

**Running Tests:**
```bash
# Run all E2E tests
npm test

# Run specific test file
npm test app-launch.spec.ts

# Run with Playwright UI (for debugging)
npm test -- --ui
npm run test:ui

# Run in debug mode (step through)
npm run test:debug

# Update screenshot baselines
npm run update-snapshots

# View test report
npm run test:report
```

**First-Time Setup:**
```bash
cd e2e
npm install
npm run install:browsers    # Install Playwright browsers
./setup-e2e.sh             # Setup test environment
```

**Key Testing Guidelines:**
- Tests interact with actual Tauri app (not mocked backend)
- Use `utils/tauri-helpers.ts` for Tauri-specific operations
- Use `utils/gpu-validation.ts` for WebGPU rendering validation
- Screenshot comparison for visual regression testing
- Tests should be idempotent and isolated
- Test data located in `../test-data/` directory
- Read `DEBUG_GUIDE.md` for troubleshooting failing tests
- Read `README.md` for testing approach and philosophy

**Writing New Tests:**
```typescript
import { test, expect } from '@playwright/test';
import { launchTauriApp } from '../utils/tauri-helpers';

test('my feature works', async ({ page }) => {
  const app = await launchTauriApp(page);

  // Interact with UI
  await page.click('button[data-testid="load-volume"]');

  // Validate
  await expect(page.locator('.volume-layer')).toBeVisible();

  // Screenshot for visual regression
  await expect(page).toHaveScreenshot('my-feature.png');
});
```

### Testing Requirements

**Test Execution:**
- All tests must pass before merging PRs
- Tests run in headless mode by default
- Use `--ui` flag for visual debugging
- Screenshot baselines stored in repo

**CI Integration:**
```yaml
# Example GitHub Actions configuration
- name: Run E2E tests
  run: |
    cd e2e
    npm ci
    npm run install:browsers
    npm test
```

**Test Coverage Areas:**
1. App Launch - Window opens, no crashes
2. Volume Loading - NIfTI files load correctly
3. Rendering - CPU and GPU paths produce correct output
4. UI Controls - Sliders, buttons, panels work
5. Multi-Volume - Overlay rendering is correct
6. Colormaps - Color mapping applies correctly
7. Atlas System - Atlas loading and selection
8. Security - Permissions and IPC validation

**Performance Benchmarks:**
- App launch < 5 seconds
- Volume load < 2 seconds for test data
- Render frame < 100ms

### Common Patterns

**App Initialization:**
```typescript
import { test } from '@playwright/test';
import { launchTauriApp } from '../utils/tauri-helpers';

test('feature test', async ({ page }) => {
  const app = await launchTauriApp(page);
  // Test logic here
});
```

**WebGPU Validation:**
```typescript
import { validateGPURendering } from '../utils/gpu-validation';

await validateGPURendering(page, {
  expectedFormat: 'rgba8unorm',
  checkForArtifacts: true
});
```

**Screenshot Comparison:**
```typescript
// Capture and compare against baseline
await expect(page).toHaveScreenshot('expected-output.png', {
  maxDiffPixels: 100  // Allow small differences
});
```

**Tauri IPC Testing:**
```typescript
// Invoke Tauri command from test
const result = await page.evaluate(() => {
  return window.__TAURI__.core.invoke('plugin:api-bridge|command', params);
});
expect(result).toBeDefined();
```

## Dependencies

### Internal
- `../ui2/` - Frontend application being tested
- `../src-tauri/` - Tauri backend being tested
- `../test-data/` - Test data files (volumes, surfaces)

### External
- `@playwright/test@1.48.0` - E2E testing framework
- `playwright@1.48.0` - Browser automation
- `@tauri-apps/cli@2.2.0` - Tauri CLI for app launching

**Browser Engines:**
- Chromium (default for Electron-based Tauri apps)
- WebKit and Firefox (optional for cross-browser testing)

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
