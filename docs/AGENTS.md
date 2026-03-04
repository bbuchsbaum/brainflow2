<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-02-10 -->

# docs - Technical Documentation

## Purpose
Comprehensive technical documentation for Brainflow2, covering architecture, design specifications, implementation guides, coordinate systems, testing strategies, and system interfaces. Serves as the authoritative reference for developers working on the project, with detailed specifications for complex subsystems like coordinate transformations, rendering pipelines, and plugin architectures.

## Key Files
| File | Description |
|------|-------------|
| `COORDINATE_SYSTEM_SPEC.md` | Formal specification of world space, image space, and coordinate transformations |
| `COORDINATE_IMPLEMENTATION_STATUS.md` | Implementation status and validation of coordinate system components |
| `design-colormap-system.md` | Colormap system design and architecture |
| `design-colormap-system-optimized.md` | Optimized colormap implementation with GPU acceleration |
| `BACKEND_TEST_QUICK_REFERENCE.md` | Quick reference for writing Rust backend tests |
| `BACKEND_TEST_IMPLEMENTATION.md` | Detailed guide for backend test implementation patterns |
| `architecture-crosshair-rendering.md` | Crosshair rendering architecture and synchronization |
| `progress-indicator-implementation.md` | Progress indicator system implementation guide |
| `alpha_mask_plan.md` | Plan for alpha mask support in volume rendering |
| `analysis_bundle_architecture.md` | Analysis bundle system architecture and plugin loading |
| `analysis_plugins.md` | Plugin system documentation for analysis extensions |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `diagrams/` | Architecture diagrams (currently empty - placeholder for future diagrams) |
| `interfaces/` | API and interface specifications (currently empty - placeholder) |

## For AI Agents

### Working In This Directory

**Reading Documentation:**
- Start with `COORDINATE_SYSTEM_SPEC.md` for spatial transformation understanding
- Read `BACKEND_TEST_QUICK_REFERENCE.md` before writing Rust tests
- Consult `design-colormap-system.md` for colormap implementation details
- Review `architecture-crosshair-rendering.md` for multi-view synchronization
- Check `COORDINATE_IMPLEMENTATION_STATUS.md` for validation status

**Key Concepts Documented:**

**Coordinate Systems:**
- World Space: LPI (Left-Posterior-Inferior) neuroimaging standard
- Image Space: IJK indices with affine transforms
- Screen Space: Pixel coordinates with aspect ratio preservation
- GPU vs CPU conventions: Y-axis direction differences and flip boundaries

**Colormap System:**
- Lookup table (LUT) based color mapping
- GPU shader implementation with 1D texture sampling
- Pre-multiplied alpha for transparency
- Support for standard colormaps (viridis, plasma, jet, etc.)

**Testing Strategy:**
- Unit tests for individual components
- Integration tests for cross-component interactions
- Visual regression tests for rendering correctness
- Property-based testing for coordinate transforms

**Plugin Architecture:**
- Analysis bundles as WebAssembly or JavaScript plugins
- Plugin manifest schema validation
- Sandboxed execution environment
- IPC communication with main app

**When to Update Documentation:**
- Coordinate system changes → Update COORDINATE_SYSTEM_SPEC.md
- New test patterns → Update BACKEND_TEST_QUICK_REFERENCE.md
- Rendering pipeline changes → Update relevant architecture docs
- Plugin API changes → Update analysis_plugins.md
- Always update COORDINATE_IMPLEMENTATION_STATUS.md after validation

### Testing Requirements

**Documentation Validation:**
- Code examples in docs should be kept up-to-date with actual implementation
- Links between docs should remain valid
- Specifications should match actual behavior (validated by tests)

**Documentation Testing:**
```bash
# Validate coordinate system implementation matches spec
cargo test -p neuro-types coord
cargo test -p render_loop world_space

# Validate colormap implementation
cargo test -p colormap

# Validate backend tests follow patterns in docs
cargo test --workspace
```

**Document Review Checklist:**
- [ ] Code examples compile and run
- [ ] Cross-references are valid
- [ ] Specifications match implementation
- [ ] Status documents are current
- [ ] Diagrams reflect actual architecture

### Common Patterns

**Coordinate Transformation Pattern:**
```rust
// As documented in COORDINATE_SYSTEM_SPEC.md
let world_point = affine_transform * image_point;
let screen_point = view_rect.world_to_screen(world_point);
```

**Colormap Application Pattern:**
```rust
// As documented in design-colormap-system.md
let normalized_value = (value - min) / (max - min);
let color = colormap.sample(normalized_value);
```

**Backend Test Pattern:**
```rust
// As documented in BACKEND_TEST_QUICK_REFERENCE.md
#[test]
fn test_feature() {
    // Arrange
    let input = setup_test_data();

    // Act
    let result = function_under_test(input);

    // Assert
    assert_eq!(result, expected);
}
```

**Plugin Manifest Pattern:**
```json
// As documented in analysis_plugins.md
{
  "name": "my-analysis",
  "version": "1.0.0",
  "entry": "dist/index.js",
  "capabilities": ["file-read", "compute"]
}
```

## Dependencies

### Internal
- References code throughout `../core/` workspace
- Describes systems in `../ui2/` frontend
- Documents interfaces in `../src-tauri/` Tauri bridge
- Specifies plugin system in `../plugins/`

### External
No direct external dependencies (documentation only), but describes usage of:
- WebGPU API
- WGSL shader language
- NIfTI file format
- GIfTI file format
- Neuroimaging coordinate systems (RAS, LPI, etc.)
- JSON Schema for plugin validation

## Documentation Standards

**File Naming:**
- Architecture documents: `architecture-{component}.md`
- Design documents: `design-{system}.md`
- Implementation guides: `{COMPONENT}_IMPLEMENTATION.md`
- Status documents: `{COMPONENT}_STATUS.md`
- Quick references: `{COMPONENT}_QUICK_REFERENCE.md`

**Document Structure:**
1. Overview and purpose
2. Key concepts and terminology
3. Architecture or design details
4. Implementation guidelines
5. Examples and patterns
6. Testing and validation
7. References and related docs

**Diagram Guidelines:**
- Place in `diagrams/` subdirectory
- Use Mermaid format when possible
- Include source files for binary formats
- Reference diagrams by relative path

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
