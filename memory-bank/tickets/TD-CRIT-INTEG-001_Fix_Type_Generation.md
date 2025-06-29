# TD-CRIT-INTEG-001: Fix Type Generation (ts-rs)

**Priority:** Critical  
**Module:** Integration  
**Stream:** C (Integration)  
**Sprint:** 0  
**Effort:** 2 days  
**Assignable:** No (requires Rust and TypeScript knowledge)  
**Dependencies:** None

### Problem Description
TypeScript type generation from Rust types is not working. The ts-rs crate is configured and types are marked with `#[derive(TS)]` and `#[ts(export)]`, but no TypeScript files are being generated. This forces manual type duplication and risks type safety.

### Current State
- ts-rs configured in Cargo workspace (version 10.1)
- Types in bridge_types marked for export
- xtask has ts-bindings command but it's incomplete
- packages/api/src/generated/index.ts is empty
- Manual type definitions duplicated in TypeScript

### Desired State
- Running `cargo xtask ts-bindings` generates TypeScript types
- Generated types appear in packages/api/src/generated/
- API package imports and re-exports generated types
- No manual type duplication needed
- Types stay synchronized automatically

### Technical Approach
1. Fix xtask implementation to actually run ts-rs export
2. Resolve version mismatch (workspace: 10.1, xtask: 7.0.0)
3. Configure export path to packages/api/src/generated
4. Update all Rust types to use consistent ts-rs attributes
5. Modify API package to import generated types
6. Add CI step to verify type generation

### Implementation Tasks
- [ ] Update xtask/Cargo.toml to use workspace ts-rs version
- [ ] Implement proper ts-rs export collection in xtask
- [ ] Add TS_RS_EXPORT_DIR configuration
- [ ] Run export for all crates with ts-rs types
- [ ] Update packages/api to import from generated/
- [ ] Remove manually duplicated type definitions
- [ ] Add type generation to CI workflow
- [ ] Document type generation process

### Acceptance Criteria
- [ ] `cargo xtask ts-bindings` produces TypeScript files
- [ ] Generated types match Rust structures
- [ ] BridgeError, Loaded, VolumeSendable types generated
- [ ] API package successfully imports generated types
- [ ] No TypeScript compilation errors
- [ ] CI verifies types are generated

### Testing Approach
- Build test: Run generation and verify files exist
- Type test: TypeScript compilation succeeds
- Integration test: Generated types work in UI code
- CI test: Automated verification in pipeline

### Risk Factors
- ts-rs may have breaking changes between versions
- Complex types might not generate correctly
- Build order dependencies in monorepo

### Notes
- Consider ts-rs export configuration options
- May need to handle custom serialization
- Watch for circular dependencies

### Code Locations
- `xtask/src/main.rs` - Fix ts-bindings command
- `core/bridge_types/src/lib.rs` - Types to export
- `packages/api/src/generated/` - Output location
- `packages/api/src/index.ts` - Import generated types

### Related Documentation
- [ts-rs documentation](https://github.com/Aleph-Alpha/ts-rs)
- Current types in bridge_types crate

---

## Status Updates

**2025-01-21**: Ticket created based on health audit findings