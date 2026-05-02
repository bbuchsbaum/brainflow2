# End-to-End Testing for Brainflow2

This directory contains automated end-to-end tests that can be run by Claude or other automation tools to validate the application's functionality.

## Testing Approach

We use **Playwright** for E2E testing because:
1. It works well with Tauri applications
2. Supports screenshot capture and visual validation
3. Can interact with both web content and native elements
4. Has excellent debugging capabilities
5. Works headless or with UI

## Setup

```bash
# Install Playwright
cd e2e
npm init -y
npm install --save-dev @playwright/test playwright

# Install Tauri testing utilities
npm install --save-dev @tauri-apps/cli
```

## Test Structure

```
e2e/
├── README.md
├── package.json
├── playwright.config.ts
├── tests/
│   ├── app-launch.spec.ts      # Basic app launch and initialization
│   ├── volume-loading.spec.ts  # Volume loading and display
│   ├── rendering.spec.ts       # Rendering pipeline validation
│   ├── ui-controls.spec.ts     # UI interaction tests
│   └── multi-volume.spec.ts    # Multi-volume overlay tests
├── fixtures/
│   ├── test-volumes/           # Test data
│   └── expected-screenshots/   # Baseline screenshots
└── utils/
    ├── tauri-helpers.ts        # Tauri-specific utilities
    ├── screenshot-compare.ts   # Visual regression tools
    └── gpu-validation.ts       # GPU rendering validation
```

## Running Tests

```bash
# Run all tests
npm test

# Run specific test
npm test rendering.spec.ts

# Run with UI (for debugging)
npm test -- --ui

# Generate screenshot baselines
npm test -- --update-snapshots
```

## Remote Mount Coverage

Remote-mount automation is opt-in because it requires an SSH fixture that can exercise trust and auth edge cases without embedding secrets in the repo.

Recommended matrix:

1. Known-host success
2. Unknown-host trust prompt
3. Host-key mismatch failure
4. Keyboard-interactive / OTP challenge
5. Auth denial
6. Local mount baseline in the same run

Suggested environment variables:

```bash
export BRAINFLOW_E2E_SSH_HOST=...
export BRAINFLOW_E2E_SSH_PORT=22
export BRAINFLOW_E2E_SSH_USER=...
export BRAINFLOW_E2E_SSH_PASSWORD=...
export BRAINFLOW_E2E_SSH_KEY_PATH=/absolute/path/to/test/key
export BRAINFLOW_E2E_SSH_OTP_SECRET=...
```

When these are configured, remote-mount tests should verify:

- `Mount Remote (SSH)…` completes the guided flow
- the mounted root shows the SSH origin indicator
- child rows do not show remote provenance badges
- opening a remote neuroimaging file stages to cache and still loads through the normal pipeline

## CI Integration

Tests can be run in CI with:
```yaml
- name: Run E2E tests
  run: |
    cd e2e
    npm ci
    npm test
```
