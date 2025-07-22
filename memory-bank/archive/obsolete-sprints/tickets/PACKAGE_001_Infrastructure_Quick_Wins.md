# Package 001: Infrastructure Quick Wins

**Type:** Independent Package  
**Total Effort:** 2 hours  
**Assignable To:** Any developer  
**Can Start:** Immediately

## Sub-Tasks (ALL Independent)

### SUB-001: Create root package.json with scripts
**Time:** 30 minutes
```json
{
  "name": "brainflow2",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "cargo tauri dev",
    "build": "pnpm -r build && cargo tauri build",
    "test:unit": "pnpm -r test:unit",
    "test:e2e": "pnpm --filter ui test:e2e",
    "test": "pnpm test:unit && cargo test",
    "lint": "pnpm -r lint && cargo clippy",
    "format": "pnpm -r format && cargo fmt",
    "check": "pnpm -r check",
    "bench": "cargo bench",
    "ts-bindings": "cargo xtask ts-bindings"
  }
}
```

### SUB-002: Update CI to use root scripts
**Time:** 15 minutes
- Change `pnpm --filter ui test:unit` to `pnpm test:unit`
- Update all script references in .github/workflows/ci.yml
- Verify CI workflow syntax

### SUB-003: Create vitest.config.ts in ui/
**Time:** 20 minutes
```typescript
import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
  plugins: [sveltekit()],
  test: {
    include: ['src/**/*.{test,spec}.{js,ts}'],
    environment: 'jsdom',
    setupFiles: ['./vitest-setup.ts'],
    globals: true
  }
});
```

### SUB-004: Fix plugin-verify schema path
**Time:** 15 minutes
- In tools/plugin-verify/src/index.ts:
- Change `plugin-manifest.schema.json` to `brainflow-plugin.json`
- Test with example manifests

### SUB-005: Update Tauri metadata
**Time:** 10 minutes
- Update src-tauri/Cargo.toml:
```toml
[package]
name = "brainflow"
version = "0.1.0"
description = "High-performance neuroimaging visualization"
authors = ["Brainflow Team"]
license = "MIT"
repository = "https://github.com/org/brainflow2"
```

## Acceptance Criteria
- [ ] All scripts work from root directory
- [ ] CI passes with new script references
- [ ] Vitest runs successfully
- [ ] Plugin verifier validates manifests
- [ ] Tauri shows correct metadata

## Testing
```bash
# From root directory
pnpm install
pnpm test:unit
pnpm lint
pnpm format
```

## Notes
- These tasks have ZERO dependencies
- Can be done in any order
- Total time: 2 hours maximum
- Perfect for onboarding or warm-up