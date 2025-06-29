# Ticket Dependency Graph

**Last Updated:** 2025-01-21  
**Total Tickets:** 52 (24 independent + 28 sequential)

## Dependency Visualization

```mermaid
graph TD
    subgraph "Independent Packages (Can Start Immediately)"
        subgraph "Package 1: Infrastructure"
            P1_1[TD-CRIT-INFRA-001: Root package.json]
            P1_2[TD-CRIT-INFRA-002: Update CI scripts]
            P1_3[TD-CRIT-INFRA-003: Vitest config]
            P1_4[TD-CRIT-INFRA-004: Fix plugin-verify]
            P1_5[TD-CRIT-INFRA-005: Update Tauri metadata]
        end
        
        subgraph "Package 2: Error Handling"
            P2_1[TD-HIGH-RUST-001: Fix api_bridge unwraps]
            P2_2[TD-HIGH-RUST-002: Fix render_loop unwraps]
            P2_3[TD-HIGH-RUST-003: Implement From traits]
            P2_4[TD-HIGH-RUST-004: Add error context]
            P2_5[TD-HIGH-RUST-005: User-friendly messages]
        end
        
        subgraph "Package 3: UI Structure"
            P3_1[TD-HIGH-UI-001: Three-canvas layout]
            P3_2[TD-HIGH-UI-002: Canvas ID management]
            P3_3[TD-HIGH-UI-003: Resize handling]
            P3_4[TD-HIGH-UI-004: View labels]
            P3_5[TD-HIGH-UI-005: ViewType enum]
        end
        
        subgraph "Package 4: Test Infrastructure"
            P4_1[TD-HIGH-TEST-001: Testing library setup]
            P4_2[TD-HIGH-TEST-002: Svelte 5 wrapper]
            P4_3[TD-HIGH-TEST-003: TreeBrowser tests]
            P4_4[TD-HIGH-TEST-004: Store tests]
            P4_5[TD-HIGH-TEST-005: Test documentation]
        end
        
        subgraph "Package 5: Documentation"
            P5_1[TD-MED-INFRA-001: Shader docs]
            P5_2[TD-MED-INFRA-002: Filesystem docs]
            P5_3[TD-MED-INFRA-003: Update context]
            P5_4[TD-MED-INFRA-004: Contributing guide]
        end
    end
    
    subgraph "Sequential Chain 1: Type Generation"
        C1_1[TD-CRIT-INTEG-001: Fix ts-rs version]
        C1_2[TD-CRIT-INTEG-002: Add TS_RS_EXPORT_DIR]
        C1_3[TD-CRIT-INTEG-003: Type collection]
        C1_4[TD-CRIT-INTEG-004: Generate bridge_types]
        C1_5[TD-CRIT-INTEG-005: Generate api_bridge]
        C1_6[TD-CRIT-INTEG-006: Update imports]
        C1_7[TD-CRIT-INTEG-007: Remove duplicates]
        C1_8[TD-CRIT-INTEG-008: Fix compilation]
        C1_9[TD-CRIT-INTEG-009: Add to CI]
        
        C1_1 --> C1_2
        C1_2 --> |Gate 1| C1_3
        C1_3 --> C1_4
        C1_4 --> C1_5
        C1_5 --> |Gate 2| C1_6
        C1_6 --> C1_7
        C1_7 --> C1_8
        C1_8 --> C1_9
    end
    
    subgraph "Sequential Chain 2: Shader Pipeline"
        C2_1[TD-CRIT-RUST-006: Research wgpu shaders]
        C2_2[TD-CRIT-RUST-007: Implement build.rs]
        C2_3[TD-CRIT-RUST-008: Create shader structure]
        C2_4[TD-CRIT-RUST-009: Write vertex shader]
        C2_5[TD-CRIT-RUST-010: Write fragment shader]
        C2_6[TD-CRIT-RUST-011: Shader validation]
        C2_7[TD-CRIT-RUST-012: Load in RenderLoop]
        C2_8[TD-CRIT-RUST-013: Create shader module]
        C2_9[TD-CRIT-RUST-014: Hot reload support]
        
        C2_1 --> C2_2
        C2_2 --> C2_3
        C2_3 --> |Gate 1| C2_4
        C2_4 --> C2_5
        C2_5 --> C2_6
        C2_6 --> |Gate 2| C2_7
        C2_7 --> C2_8
        C2_8 --> C2_9
    end
    
    subgraph "Sequential Chain 3: Data Flow"
        C3_1[TD-CRIT-RUST-015: Implement NiftiLoader]
        C3_2[TD-CRIT-RUST-016: Create VolumeData]
        C3_3[TD-CRIT-RUST-017: Test with toy data]
        C3_4[TD-CRIT-RUST-018: Create Registry]
        C3_5[TD-CRIT-RUST-019: Store volumes]
        C3_6[TD-CRIT-RUST-020: Handle lookup]
        C3_7[TD-CRIT-RUST-021: GPU resources impl]
        C3_8[TD-CRIT-RUST-022: Extract slices]
        C3_9[TD-CRIT-RUST-023: Return GPU info]
        
        C3_1 --> C3_2
        C3_2 --> C3_3
        C3_3 --> |Gate 1| C3_4
        C3_4 --> C3_5
        C3_5 --> C3_6
        C3_6 --> |Gate 2| C3_7
        C3_7 --> C3_8
        C3_8 --> C3_9
    end
    
    subgraph "Sprint 1 Dependencies"
        S1_1[GPU Pipeline]
        S1_2[API Additions]
        S1_3[Performance]
        
        C1_9 --> S1_2
        C2_9 --> S1_1
        C3_9 --> S1_1
    end
```

## Critical Path

The critical path runs through all three sequential chains, which must complete before Sprint 1 GPU work can begin:

1. **Type Generation** (4 days) - Blocks API additions
2. **Shader Pipeline** (3 days) - Blocks GPU pipeline
3. **Data Flow** (4 days) - Blocks GPU pipeline

**Total Critical Path:** 11 days (with parallel execution: 4 days)

## Dependency Rules

### Independent Packages
- Can be started by any available developer
- Have no blockers or dependencies
- Can be completed in any order
- Should be distributed for maximum parallelism

### Sequential Chains
- Must be completed in exact order
- Gates prevent proceeding until verified
- Single owner recommended for continuity
- Buffer time included in estimates

### Cross-Dependencies
- UI Structure (Package 3) helps GPU integration testing
- Error Handling (Package 2) helps all development
- Type Generation (Chain 1) enables UI TypeScript work

## Sprint Boundaries

### Sprint 0 Must Complete
- All 5 independent packages
- All 3 sequential chains
- 0 critical blockers remaining

### Sprint 1 Can Start When
- Type generation working (Chain 1 done)
- Shaders loading (Chain 2 done)
- Data available (Chain 3 done)

### Sprint 2 Prerequisites
- GPU pipeline rendering
- Basic UI displaying data
- Performance baselines established

## Tracking Checklist

### Daily Checks
- [ ] No sequential task started before predecessor
- [ ] Gates verified before proceeding
- [ ] Independent work distributed
- [ ] Blockers identified early

### Sprint Checks
- [ ] Critical path on schedule
- [ ] Dependencies respected
- [ ] Integration points tested
- [ ] No orphaned work

---

**Note:** This dependency graph is the source of truth for task ordering. Any deviation requires architectural approval.