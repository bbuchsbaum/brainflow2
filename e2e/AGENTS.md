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

## Isolated population visual harness

`playwright.population.config.ts` runs only `harness/population-export.spec.ts` against an owned Vite server on port 5321 (`reuseExistingServer: false`). This is an explicit exception to the native-app tests above: the real Population controls/canvases run with labeled synthetic sampling, file choice and export IPC. It checks participant/mask export operands, fixed scales, focus, restored probe values and desktop/narrow layout; screenshots require visual inspection and are not native Tauri acceptance. Run `pnpm --dir e2e exec playwright test --config playwright.population.config.ts`; install this package's pinned Chromium first. `POPULATION_QA_BROWSER` optionally selects an automation executable, and `POPULATION_QA_OUTPUT` redirects artifacts. Perform the root browser-ownership audit before and after, and never use a user's Chrome profile.

The population harness also tests saved-summary replay: its simulated chooser returns the exported JSON path, its command receipt contains only record/output paths and the ticket, and live focus/weighting stay unchanged. Desktop and narrow screenshots are produced for inspection. Native record/artifact/source integrity and byte-equivalent publication are Rust-test responsibilities.

## Isolated surface renderer harness

`playwright.surfview.config.ts` runs `harness/surfview.spec.ts` on an owned Vite
server at port 5339 (`reuseExistingServer: false`). This is another explicit
exception to native-app tests: `ui2/surfview-harness.html` mounts the real shared
surface canvas with synthetic geometry/data, without Tauri. Run
`pnpm --dir e2e exec playwright test --config playwright.surfview.config.ts`.
`SURFVIEW_QA_BROWSER` selects an installed automation Chromium executable;
`SURFVIEW_QA_OUTPUT` redirects artifacts. Perform browser-ownership audits before
and after; preserve other sessions' browsers. Pixel, lighting and lifecycle
checks qualify this browser integration, not native desktop or all GPU backends.

## App-harness screenshot gate

`playwright.app-harness.visual.config.ts` runs `harness/app-harness.visual.spec.ts`
on an owned Vite server at port 5329 (`reuseExistingServer: false`;
`APP_HARNESS_PORT` overrides). It renders every full-app harness scenario
(`ui2/app-harness.html`, list shared with the capture spec in
`harness/app-harness.scenarios.ts`), the 1280x800 variants and the four
`primitives-harness.html` gallery pages with the capture spec's determinism
(freeze CSS, SwiftShader, fixed locale/timezone/fonts), fails on boot, page or
backend-handler errors, and compares each against
`harness/__screenshots__/darwin/<name>.png`.

- Run: `pnpm --dir e2e test:app-harness:visual` (or
  `node_modules/.bin/playwright test -c playwright.app-harness.visual.config.ts`
  from `e2e/`). `APP_HARNESS_SCENARIOS=volume,primitives` restricts the run.
- Update baselines only for an intended visual change: rerun with
  `--update-snapshots`, open the changed PNGs and check them, and commit them
  with the change that caused them. Never update to make an unexplained diff pass.
- Tolerance is `maxDiffPixels: 24, threshold: 0.1`: two specimens flake by
  1-8 antialiased pixels between identical runs, while any real chrome change
  moves far more. Do not loosen it to absorb a regression.
- Sensitivity check: `APP_HARNESS_VISUAL_PROBE=1` injects a 1px body outline
  through the init script; every specimen must then fail.
- Baselines are tied to the pinned headless shell (`APP_HARNESS_BROWSER`
  overrides) on macOS arm64; another platform needs its own baseline set.
  Audit browser ownership before and after, as for the other harnesses.

## Segmentation design captures

`playwright.segmentation-design.config.ts` runs
`harness/segmentation-design.capture.spec.ts` on an owned Vite server at port
5331 (`SEG_DESIGN_PORT`). It renders `ui2/segmentation-harness.html` for every
design direction x state (mock data, no Tauri) and writes
`cruft/hillclimb/segmentation/<SEG_DESIGN_ROUND>/<direction>/<state>.png` plus
`manifest.json`; it fails on harness, page or console errors. Set
`SEG_DESIGN_BROWSER` to an installed Chromium headless shell;
`SEG_DESIGN_DIRECTIONS` / `SEG_DESIGN_STATES` restrict the run. These are
design specimens for critique, not a regression gate.

Design parity: `SEG_DESIGN_PARITY=1` renders direction h's states and
compares each with `docs/design/segmentation/reference/` (pixels whose
largest channel difference exceeds `SEG_DESIGN_PARITY_THRESHOLD`, default
24; a state fails above `SEG_DESIGN_PARITY_MAX` of them, default 0.005).
Renders, `diff/<state>.png` and `parity.json` go to
`test-results/segmentation-parity`. It is advisory and not in CI; see
`ui2/src/modules/segmentation/AGENTS.md` ("Design parity").
