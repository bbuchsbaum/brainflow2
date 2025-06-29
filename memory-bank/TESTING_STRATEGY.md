# Comprehensive Testing Strategy for Technical Debt Reduction

**Version:** 1.0  
**Created:** 2025-01-21  
**Purpose:** Ensure quality and prevent regressions during major refactoring

## Executive Summary

With 42 technical debt items being addressed across parallel work streams, we need a robust testing strategy that:
- Prevents regressions in working features
- Validates each fix independently
- Ensures integration points work correctly
- Provides confidence for continuous deployment

## Testing Philosophy

### Test Pyramid
```
         E2E Tests (5%)
        /           \
   Integration Tests (25%)
   /                    \
Unit Tests (70%)         
```

### Coverage Requirements
- **New Code:** 80% minimum
- **Modified Code:** Must maintain or improve coverage
- **Critical Paths:** 95% coverage required
- **Overall Target:** 70% by end of Sprint 2

## Test Categories

### 1. Unit Tests (70% of tests)

#### Rust Unit Tests
**Location:** In each crate's `src/` directory as `#[cfg(test)]` modules

**Required for Every Debt Fix:**
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_happy_path() {
        // Test normal operation
    }

    #[test]
    fn test_error_handling() {
        // Test error cases
    }

    #[test]
    fn test_edge_cases() {
        // Test boundaries
    }
}
```

**Key Areas:**
- Volume loading functions
- Shader compilation
- Data transformations
- Error handling paths
- GPU resource management

#### TypeScript Unit Tests
**Location:** Adjacent to source files as `.test.ts` or `.spec.ts`

**Framework:** Vitest (already in project)
```typescript
import { describe, it, expect, beforeEach } from 'vitest';

describe('ComponentName', () => {
  beforeEach(() => {
    // Setup
  });

  it('should handle normal operation', () => {
    // Test
  });

  it('should handle errors gracefully', () => {
    // Test
  });
});
```

**Key Areas:**
- Store mutations
- Component logic
- API wrappers
- Type safety
- Event handlers

### 2. Integration Tests (25% of tests)

#### Rust Integration Tests
**Location:** `tests/` directory in each crate

**Critical Integration Points:**
```rust
// tests/api_bridge_integration.rs
#[test]
fn test_load_volume_to_gpu_flow() {
    // Test complete flow from load to GPU
}

#[test]
fn test_render_pipeline_creation() {
    // Test shader + pipeline integration
}
```

#### Cross-Boundary Tests
**Location:** `src-tauri/tests/`

**Test Scenarios:**
1. **Load → Store → Render Flow**
   ```rust
   #[test]
   fn test_nifti_load_render_cycle() {
       // 1. Load NIfTI file
       // 2. Store in registry
       // 3. Upload to GPU
       // 4. Render frame
       // 5. Verify output
   }
   ```

2. **Type Generation → API Usage**
   ```typescript
   // packages/api/tests/generated-types.test.ts
   it('should use generated types correctly', () => {
     // Verify ts-rs generated types work
   });
   ```

3. **Multi-View Synchronization**
   ```typescript
   it('should sync all three views', () => {
     // Test axial/coronal/sagittal sync
   });
   ```

### 3. End-to-End Tests (5% of tests)

**Location:** `ui/e2e/`  
**Framework:** Playwright with Tauri

**Critical User Journeys:**

#### Journey 1: Load and View NIfTI
```typescript
test('user can load and view NIfTI file', async ({ page }) => {
  // 1. Launch app
  // 2. Click load button
  // 3. Select test file
  // 4. Verify image displays
  // 5. Verify all three views
  // 6. Test navigation
});
```

#### Journey 2: Layer Management
```typescript
test('user can manage multiple layers', async ({ page }) => {
  // 1. Load base image
  // 2. Add overlay
  // 3. Adjust opacity
  // 4. Toggle visibility
  // 5. Remove layer
});
```

#### Journey 3: Performance Under Load
```typescript
test('app handles large volumes', async ({ page }) => {
  // 1. Load 512x512x200 volume
  // 2. Verify smooth navigation
  // 3. Check memory usage
  // 4. Verify no crashes
});
```

## Test Data Management

### Test Data Sets
```
test-data/
├── nifti/
│   ├── toy_t1w.nii.gz (small, for unit tests)
│   ├── test_brain.nii.gz (medium, for integration)
│   └── large_brain.nii.gz (large, for performance)
├── gifti/
│   └── test_surface.gii
└── expected/
    ├── rendered_slices/
    └── gpu_textures/
```

### Fixtures
```rust
// core/test_utils/src/lib.rs
pub fn create_test_volume(size: (u32, u32, u32)) -> Volume {
    // Generate predictable test data
}

pub fn load_test_nifti() -> PathBuf {
    // Return path to test file
}
```

## Testing During Sprint 0

### Week 1 Test Requirements

#### Package 1: Infrastructure (Day 1-2)
- [ ] Test all npm scripts work
- [ ] Verify CI runs with new scripts
- [ ] Test vitest configuration

#### Package 2: Error Handling (Day 1-5)
```rust
// For each unwrap() removed:
#[test]
fn test_error_propagation() {
    let result = function_that_could_fail();
    assert!(result.is_err());
    assert_eq!(result.unwrap_err().kind(), ErrorKind::Expected);
}
```

#### Package 3: UI Structure (Day 1-5)
```typescript
// For three-panel layout:
describe('VolumeView', () => {
  it('should render three canvases', () => {
    const { container } = render(VolumeView);
    expect(container.querySelectorAll('canvas')).toHaveLength(3);
  });

  it('should handle resize events', () => {
    // Test resize logic
  });
});
```

#### Sequential Chains: Gate Tests

**Gate 1 Tests (Type Generation):**
```bash
# Automated gate test
./scripts/test-type-generation.sh
✓ ts-rs versions match
✓ Environment configured
✓ Can generate types
```

**Gate 2 Tests (Shaders):**
```bash
# Automated gate test
./scripts/test-shader-compilation.sh
✓ Shaders compile
✓ No validation errors
✓ Can load at runtime
```

### Week 2 Integration Focus

All three chains must integrate:
```rust
#[test]
fn test_complete_rendering_pipeline() {
    // 1. Load data (Chain 3)
    let volume = load_test_volume();
    
    // 2. Use generated types (Chain 1)
    let handle: VolumeHandle = store_volume(volume);
    
    // 3. Render with shaders (Chain 2)
    let frame = render_frame(handle, SliceParams::default());
    
    assert!(frame.is_ok());
}
```

## Continuous Testing

### Pre-Commit Hooks
```yaml
# .pre-commit-config.yaml
repos:
  - repo: local
    hooks:
      - id: rust-test
        name: Rust Tests
        entry: cargo test
        language: system
        types: [rust]
      
      - id: typescript-test
        name: TypeScript Tests
        entry: pnpm test:unit
        language: system
        types: [typescript]
```

### CI Pipeline Changes
```yaml
# .github/workflows/ci.yml
test:
  strategy:
    matrix:
      include:
        - name: "Unit Tests"
          command: "cargo test --workspace"
        - name: "Integration Tests"  
          command: "cargo test --test '*' --features integration"
        - name: "TypeScript Tests"
          command: "pnpm test:unit"
        - name: "E2E Tests"
          command: "pnpm test:e2e"
```

### Daily Test Report
```markdown
## Test Status - [Date]

### Test Metrics
- Unit Tests: X/Y passing (Z% coverage)
- Integration Tests: A/B passing
- E2E Tests: C/D passing
- New Tests Added: E
- Tests Fixed: F

### Failed Tests
| Test | Module | Owner | Priority |
|------|--------|-------|----------|
| | | | |

### Coverage Delta
- Overall: +X%
- New Code: Y%
- Critical Paths: Z%
```

## Test Writing Guidelines

### Good Test Principles
1. **Isolated** - No dependencies on external state
2. **Repeatable** - Same result every time
3. **Fast** - Milliseconds, not seconds
4. **Clear** - Obvious what failed and why

### Test Naming Convention
```rust
#[test]
fn test_<system>_<condition>_<expected_result>() {
    // Example: test_volume_loader_missing_file_returns_error
}
```

### Mock Guidelines
```rust
// Use mockall for Rust mocking
#[cfg(test)]
use mockall::{automock, predicate::*};

#[automock]
trait VolumeLoader {
    fn load(&self, path: &Path) -> Result<Volume>;
}
```

```typescript
// Use vitest mocks for TypeScript
vi.mock('@brainflow/api', () => ({
  loadVolume: vi.fn(() => Promise.resolve(mockVolume))
}));
```

## Performance Testing

### Benchmarks
```rust
// benches/render_benchmark.rs
use criterion::{criterion_group, criterion_main, Criterion};

fn render_benchmark(c: &mut Criterion) {
    c.bench_function("render_slice", |b| {
        b.iter(|| render_slice(&volume, 50))
    });
}
```

### Load Tests
```typescript
// performance/load-test.ts
test('handles 100 rapid slice changes', async () => {
  const times = [];
  for (let i = 0; i < 100; i++) {
    const start = performance.now();
    await changeSlice(i);
    times.push(performance.now() - start);
  }
  
  const p95 = percentile(times, 0.95);
  expect(p95).toBeLessThan(16); // 60fps
});
```

## Risk-Based Testing

### Critical Paths (Must Have 95% Coverage)
1. **NIfTI Loading** → Volume Storage → GPU Upload
2. **Shader Compilation** → Pipeline Creation → Rendering
3. **User Interaction** → State Update → View Sync

### High-Risk Changes
| Change | Risk | Test Strategy |
|--------|------|---------------|
| Remove all unwrap() | Panics | Test every error path |
| Type generation | Type mismatches | Integration tests |
| GPU pipeline | Render failures | Visual regression tests |
| Three-view sync | Desync bugs | E2E journey tests |

## Regression Prevention

### Snapshot Testing
```typescript
// For UI components
expect(render(VolumeView).container).toMatchSnapshot();
```

### Visual Regression
```typescript
// For rendered output
const screenshot = await page.screenshot();
expect(screenshot).toMatchSnapshot('volume-render.png');
```

### Contract Testing
```typescript
// For API boundaries
expect(apiResponse).toMatchSchema(volumeHandleSchema);
```

## Test Maintenance

### When Adding Debt Fix
1. Write failing test that demonstrates the bug
2. Fix the issue
3. Verify test passes
4. Add regression test

### When Refactoring
1. Ensure existing tests pass
2. Add tests for new structure
3. Remove obsolete tests
4. Update test documentation

## Success Metrics

### Sprint 0 Test Goals
- [ ] 0 failing tests in main
- [ ] 50% overall coverage
- [ ] 80% coverage on new code
- [ ] All critical paths tested
- [ ] E2E smoke tests passing

### Sprint 1 Test Goals
- [ ] 70% overall coverage
- [ ] All integration tests passing
- [ ] Performance benchmarks established
- [ ] Visual regression suite active

### Sprint 2 Test Goals
- [ ] 80% overall coverage
- [ ] Full E2E test suite
- [ ] Load testing complete
- [ ] Automated performance gates

## Emergency Procedures

### If Tests Break During Sprint
1. **Stop** - Don't push broken tests
2. **Isolate** - Find minimal reproduction
3. **Communicate** - Alert team in Slack
4. **Fix or Skip** - Fix immediately or skip with issue number
5. **Document** - Add to retrospective

### Test Flakiness
- Run 3x before declaring flaky
- Add to flaky test list
- Assign owner to fix
- Use retry logic sparingly

---

This testing strategy ensures that as we fix technical debt, we build a robust test suite that prevents regressions and enables confident refactoring. Every PR must improve or maintain test coverage.