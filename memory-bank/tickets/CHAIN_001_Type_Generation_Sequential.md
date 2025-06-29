# Chain 001: Type Generation Sequential Tasks

**Type:** Sequential Chain  
**Total Effort:** 4 days  
**Assignable To:** Full-Stack Developer D  
**Must Complete In Order:** Yes

## Dependency Chain
```
Phase 1 (Day 1) → Gate 1 → Phase 2 (Day 2) → Gate 2 → Phase 3 (Day 3-4)
```

## Phase 1: Fix Infrastructure (Day 1)

### SEQ-001: Update xtask ts-rs version
**Status Gate:** Version numbers match
```toml
# In xtask/Cargo.toml, change:
ts-rs = "7.0.0"
# To:
ts-rs = { workspace = true }
```

### SEQ-002: Add TS_RS_EXPORT_DIR configuration  
**Status Gate:** Environment configured
```rust
// In xtask/src/main.rs
std::env::set_var("TS_RS_EXPORT_DIR", "../packages/api/src/generated");
```

### Gate 1 Verification
```bash
cd xtask
cargo tree | grep ts-rs  # Should show 10.1.0
```

## Phase 2: Implement Generation (Day 2)

### SEQ-003: Implement type collection
**Blocked Until:** Gate 1 passes
```rust
// In xtask/src/main.rs
fn collect_types() -> Result<()> {
    // Walk through core/bridge_types/src/
    // Find all #[ts(export)] markers
    // Generate a list of types to export
}
```

### SEQ-004: Generate from bridge_types
**Blocked Until:** SEQ-003 complete
```rust
// Force generation by importing types
use bridge_types::{BridgeError, Loaded, VolumeSendable, VolumeLayerGPU};
// ts-rs will generate on build
```

### SEQ-005: Generate from api_bridge
**Blocked Until:** SEQ-004 complete
```rust
// Similar for api_bridge types
use api_bridge::{VolumeHandleInfo, TreePayload, FlatNode};
```

### Gate 2 Verification
```bash
ls packages/api/src/generated/  # Should see .ts files
cat packages/api/src/generated/bridge_types.ts  # Should have content
```

## Phase 3: Integration (Day 3-4)

### SEQ-006: Update packages/api/src/index.ts
**Blocked Until:** Gate 2 passes
```typescript
// Add at top of file
export * from './generated/bridge_types';
export * from './generated/api_bridge';

// Remove manual definitions of:
// - BridgeError
// - Loaded  
// - VolumeSendable
// - etc.
```

### SEQ-007: Remove manual type duplications
**Blocked Until:** SEQ-006 complete
- Search for duplicate type definitions
- Remove from packages/api/src/index.ts
- Keep only TypeScript-specific types

### SEQ-008: Fix TypeScript compilation
**Blocked Until:** SEQ-007 complete
- Run `pnpm --filter @brainflow/api build`
- Fix any type mismatches
- Update imports in UI code

### SEQ-009: Add to CI
**Blocked Until:** SEQ-008 complete
```yaml
# In .github/workflows/ci.yml
- name: Generate TypeScript Bindings
  run: cargo xtask ts-bindings
  
- name: Verify Types Generated
  run: |
    test -f packages/api/src/generated/bridge_types.ts
    test -f packages/api/src/generated/api_bridge.ts
```

## Success Criteria
- [ ] Phase 1: Versions aligned, environment set
- [ ] Phase 2: Types generating to correct location
- [ ] Phase 3: UI compiles with generated types
- [ ] CI includes type generation step

## Rollback Plan
If type generation fails:
1. Keep manual types temporarily
2. Document mismatches
3. Fix in next sprint

## Common Issues
1. **Path issues**: Use absolute paths from workspace root
2. **Version conflicts**: Ensure workspace = true
3. **Missing exports**: Add #[ts(export)] to Rust types
4. **Import errors**: Update tsconfig.json paths

## Testing Commands
```bash
# Test generation
cargo xtask ts-bindings

# Test compilation  
pnpm --filter @brainflow/api build

# Test integration
pnpm --filter ui check
```

## Notes
- This MUST be done sequentially
- Each phase depends on the previous
- Gates prevent wasted work
- Total time assumes no major blockers