# Brainflow Technical Debt Register

**Date:** 2025-01-21  
**Total Items:** 42  
**Critical Items:** 8  
**Debt Score:** High

## Priority Classification

- 🔴 **Critical** - Blocks core functionality
- 🟠 **High** - Significantly impacts development or reliability  
- 🟡 **Medium** - Should be addressed soon
- 🟢 **Low** - Nice to have, can wait

---

## 🔴 Critical Technical Debt (Must Fix Immediately)

### CD-001: WebGPU Rendering Pipeline Not Connected
**Module:** Rust Core / Render Loop  
**Impact:** No visualization possible  
**Effort:** 3-5 days  
**Details:**
- Shader compilation disabled in build.rs
- Render pipeline not created
- Only clears screen, no actual rendering
**Fix:** Re-enable wgsl_to_wgpu, implement full pipeline

### CD-002: Data Flow Disconnect
**Module:** Rust Core / API Bridge  
**Impact:** Loaded data can't reach GPU  
**Effort:** 2-3 days  
**Details:**
- Loaders return metadata only, not volume data
- No volume registry → GPU connection
- `request_layer_gpu_resources` incomplete
**Fix:** Implement proper data storage and GPU upload path

### CD-003: Missing API Function
**Module:** Rust Core / Frontend  
**Impact:** VolumeView can't update rendering  
**Effort:** 1 day  
**Details:**
- `update_frame_ubo` called in UI but not exposed
- Blocks view synchronization
**Fix:** Add function to API bridge

### CD-004: Type Generation Broken
**Module:** Infrastructure / Shared Packages  
**Impact:** Type safety compromised  
**Effort:** 1-2 days  
**Details:**
- ts-rs configured but not generating
- Manual type duplication
- Version mismatch (10.1 vs 7.0)
**Fix:** Fix xtask implementation, align versions

### CD-005: No SharedArrayBuffer Implementation
**Module:** Rust Core / Frontend  
**Impact:** Can't achieve zero-copy transfer  
**Effort:** 3-4 days  
**Details:**
- Blueprint requires SAB for performance
- Current implementation copies data
**Fix:** Implement SAB allocation and transfer

### CD-006: Single Canvas Instead of 3-Panel
**Module:** Frontend UI  
**Impact:** Not meeting blueprint requirements  
**Effort:** 2-3 days  
**Details:**
- VolumeView has one canvas
- Should have orthogonal Ax/Cor/Sag views
**Fix:** Implement proper layout with 3 WebGPU contexts

### CD-007: Loader Implementation Incomplete
**Module:** Rust Core / Loaders  
**Impact:** Can't properly load files  
**Effort:** 2 days  
**Details:**
- NiftiLoader `load` hits todo!()
- GiftiLoader not implemented
- No actual data returned
**Fix:** Complete loader implementations

### CD-008: No Test Coverage
**Module:** All  
**Impact:** No confidence in changes  
**Effort:** Ongoing  
**Details:**
- ~10% coverage
- No integration tests
- No component tests
**Fix:** Add tests for critical paths first

---

## 🟠 High Priority Technical Debt

### HD-001: Error Handling Uses Panics
**Module:** Rust Core  
**Impact:** Poor user experience, crashes  
**Effort:** 2 days  
**Details:**
- Many unwrap() calls
- Errors cause panics instead of recovery
**Fix:** Proper Result handling throughout

### HD-002: Missing Root package.json
**Module:** Infrastructure  
**Impact:** Monorepo scripts don't work  
**Effort:** 1 hour  
**Details:**
- CI references missing scripts
- No coordination commands
**Fix:** Create root package.json with scripts

### HD-003: Plugin System Not Implemented
**Module:** Plugin System  
**Impact:** Can't extend functionality  
**Effort:** 1 week  
**Details:**
- Only interfaces exist
- No loading mechanism
- No actual plugins
**Fix:** Implement after core features work

### HD-004: Mutex Should Be RwLock
**Module:** Rust Core  
**Impact:** Performance bottleneck  
**Effort:** 1 day  
**Details:**
- Read-heavy locks using Mutex
- Noted in Sprint 2 backlog
**Fix:** Refactor to RwLock where appropriate

### HD-005: No Performance Benchmarks
**Module:** Test Infrastructure  
**Impact:** Can't verify requirements  
**Effort:** 2 days  
**Details:**
- Blueprint has specific perf targets
- No benchmarks implemented
**Fix:** Add criterion benchmarks

### HD-006: CI Only Tests Linux E2E
**Module:** Infrastructure  
**Impact:** Cross-platform issues hidden  
**Effort:** 1 day  
**Details:**
- E2E tests restricted to Linux
- Windows/macOS untested
**Fix:** Enable multi-platform E2E

---

## 🟡 Medium Priority Technical Debt

### MD-001: Tauri Metadata Placeholder
**Module:** Infrastructure  
**Details:** Default values in Cargo.toml
**Fix:** Update with proper project info

### MD-002: wgpu Version Confusion
**Module:** Rust Core  
**Details:** Comments reference v25, using v20
**Fix:** Align versions or update comments

### MD-003: Legacy-ts Empty
**Module:** Shared Packages  
**Details:** Only placeholder implementations
**Fix:** Migrate actual legacy code

### MD-004: No Vitest Config
**Module:** Frontend UI  
**Details:** Missing configuration file
**Fix:** Create vitest.config.ts

### MD-005: Shader Hot-Reload Missing
**Module:** Rust Core  
**Details:** No dev-time shader reload
**Fix:** Implement watch mechanism

### MD-006: Plugin Verifier Path Wrong
**Module:** Tools  
**Details:** Wrong schema file path
**Fix:** Update to correct path

### MD-007: No Git LFS for Test Data
**Module:** Infrastructure  
**Details:** Binary files in regular git
**Fix:** Configure Git LFS

### MD-008: Incomplete xtask Commands
**Module:** Infrastructure  
**Details:** Only ts-bindings implemented
**Fix:** Add clean, dist, release

### MD-009: No Loading States
**Module:** Frontend UI  
**Details:** UI doesn't show progress
**Fix:** Add loading indicators

### MD-010: File System Module Empty
**Module:** Rust Core  
**Details:** Placeholder implementation
**Fix:** Implement or remove

---

## 🟢 Low Priority Technical Debt

### LD-001: No Dark Mode
**Module:** Frontend UI  
**Details:** Only light theme
**Fix:** Add theme support

### LD-002: Basic Styling Only
**Module:** Frontend UI  
**Details:** Minimal visual design
**Fix:** Implement design system

### LD-003: No Keyboard Shortcuts
**Module:** Frontend UI  
**Details:** Mouse-only interaction
**Fix:** Add keyboard support

### LD-004: Limited Test Data
**Module:** Test Infrastructure  
**Details:** Only one test file
**Fix:** Add variety of test data

### LD-005: No Visual Regression Tests
**Module:** Test Infrastructure  
**Details:** No screenshot comparison
**Fix:** Add visual testing

### LD-006: No Documentation Site
**Module:** Documentation  
**Details:** Only markdown files
**Fix:** Generate docs site

### LD-007: No Release Automation
**Module:** Infrastructure  
**Details:** Manual release process
**Fix:** Add release workflow

### LD-008: No Telemetry
**Module:** All  
**Details:** No usage analytics
**Fix:** Add opt-in telemetry

### LD-009: No Logging Infrastructure
**Module:** Rust Core  
**Details:** Limited tracing setup
**Fix:** Comprehensive logging

### LD-010: No Security Audit
**Module:** All  
**Details:** Dependencies not audited
**Fix:** Add cargo-audit, npm audit

---

## Debt Metrics

### By Module:
- Rust Core: 15 items (36%)
- Frontend UI: 10 items (24%)
- Infrastructure: 9 items (21%)
- Test Infrastructure: 5 items (12%)
- Plugin System: 3 items (7%)

### By Priority:
- Critical: 8 items (19%)
- High: 6 items (14%)
- Medium: 10 items (24%)
- Low: 10 items (24%)
- Unclassified: 8 items (19%)

### Estimated Effort:
- Critical items: ~20 days
- High items: ~12 days
- Medium items: ~10 days
- Low items: ~15 days
- **Total: ~57 developer days**

## Recommendations

1. **Stop New Features**: Focus only on critical debt
2. **Pair Programming**: Critical items need collaboration
3. **Daily Debt Review**: Track progress on critical items
4. **Test as You Fix**: Add tests when fixing debt
5. **Document Fixes**: Update docs as debt is resolved

## Next Review Date: 2025-02-01

The technical debt is manageable but requires immediate attention to critical items. The good architecture makes fixes straightforward once the core data flow is established.