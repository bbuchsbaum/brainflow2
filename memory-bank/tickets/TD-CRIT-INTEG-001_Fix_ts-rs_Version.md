# TD-CRIT-INTEG-001: Fix ts-rs Version Alignment

**Status:** Not Started  
**Assignee:** Dev D (Full-Stack)  
**Sprint:** Sprint 0  
**Effort:** 4 hours  
**Priority:** Critical  

## Description

The xtask crate is using ts-rs version 7.0.0 while the workspace uses 10.1.0. This version mismatch prevents proper TypeScript type generation, blocking the entire type safety chain.

## Current State

- xtask/Cargo.toml has explicit version: `ts-rs = "7.0.0"`
- Workspace Cargo.toml defines: `ts-rs = "10.1.0"`
- Type generation fails silently due to API differences
- No TypeScript types are being generated

## Desired State

- All crates use workspace version (10.1.0)
- Type generation works consistently
- Version conflicts eliminated
- Single source of truth for dependencies

## Technical Details

### Root Cause
Historical: xtask was created before workspace dependency management was established, using the then-current version 7.0.0.

### Impact
- **User Impact:** None (development tooling)
- **Developer Impact:** Cannot generate TypeScript types, forcing manual type duplication
- **System Impact:** Type safety broken between Rust and TypeScript

## Implementation Plan

### Approach
1. Update xtask/Cargo.toml to use workspace version
2. Run cargo update in xtask directory
3. Verify version alignment with cargo tree
4. Test type generation command

### Code Changes Required
```
Files to modify:
- xtask/Cargo.toml

Key changes:
- Change: ts-rs = "7.0.0"
- To: ts-rs = { workspace = true }
```

## Dependencies

### Blocks
- TD-CRIT-INTEG-003: Type collection implementation
- TD-CRIT-INTEG-004: Generate bridge_types
- All downstream type generation work

### Blocked By
- None (can start immediately)

### Related
- TD-CRIT-INTEG-002: Add TS_RS_EXPORT_DIR (same phase)

## Acceptance Criteria

- [ ] xtask uses workspace ts-rs version
- [ ] `cargo tree | grep ts-rs` shows 10.1.0 for all crates
- [ ] No compilation errors in xtask
- [ ] `cargo xtask ts-bindings` runs without version errors
- [ ] Git diff shows only Cargo.toml change

## Testing Plan

### Unit Tests
- N/A (configuration change)

### Integration Tests
- [ ] Run cargo build in xtask
- [ ] Run cargo xtask ts-bindings (may fail until Chain 1 complete)

### Manual Testing
- [ ] Verify with: `cd xtask && cargo tree | grep ts-rs`
- [ ] Check for version warnings in build output

## Risks

### Technical Risks
- API changes between 7.0.0 and 10.1.0 may require code updates
  - Mitigation: Review ts-rs changelog, update usage if needed

### Timeline Risks
- None (straightforward change)

## Resources

### Documentation
- [ts-rs documentation](https://github.com/Aleph-Alpha/ts-rs)
- [Cargo workspace dependencies](https://doc.rust-lang.org/cargo/reference/workspaces.html)

### Similar Work
- Previous workspace dependency consolidation

## Progress Log

### [Date] - Dev D
- Work not yet started

## Review Notes

### Code Review
- **Reviewer:** [Pending]
- **Date:** [Pending]
- **Comments:** [Pending]

## Completion Checklist

- [ ] Code implemented
- [ ] Tests passing
- [ ] Documentation updated (if needed)
- [ ] PR created and linked
- [ ] Code reviewed
- [ ] Merged to main
- [ ] Ticket closed

---

**PR Link:** [Pending]  
**Completion Date:** [Pending]  
**Actual Effort:** [Pending]