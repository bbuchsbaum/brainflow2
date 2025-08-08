# GIFTI Implementation Investigation Report: neurosurf-rs

## Executive Summary

This report provides a comprehensive analysis of the GIFTI (Geometry Format Under the Neuroimaging Informatics Technology Initiative) implementation in the `neurosurf-rs` Rust library located at `/Users/bbuchsbaum/code/rust/neurosurf-rs`. The investigation focused on how GIFTI files are read, parsed, and how the library distinguishes between different GIFTI intents (geometry vs functional data).

## Key Findings

### 1. GIFTI Implementation Architecture

The neurosurf-rs library implements GIFTI support through a modular architecture:

- **Location**: `/Users/bbuchsbaum/code/rust/neurosurf-rs/src/io/gifti.rs`
- **Feature-gated**: GIFTI support is conditionally compiled using the `gifti-support` feature flag
- **External dependency**: Uses a local `gifti-rs` library (`path = "../gifti-rs"`) for core GIFTI operations

### 2. GIFTI Intent Detection and Content Type Determination

The library distinguishes between different GIFTI content types using **Intent-based detection**:

```rust
// Coordinate/geometry data detection
let coord_array = gifti_data.get_first_data_array_by_intent(Intent::Pointset)

// Triangle/face data detection  
let triangle_array = gifti_data.get_first_data_array_by_intent(Intent::Triangle)
```

**Intent Types Used**:
- `Intent::Pointset` - For vertex coordinates/geometry data
- `Intent::Triangle` - For triangle face indices

### 3. File Reading and Parsing Process

**Reading Pipeline**:
1. **File Detection**: Extension-based detection (`.gii` files)
2. **Existence Check**: Verifies file exists before attempting to read
3. **External Library Call**: Uses `gifti_read()` from `gifti-rs` for parsing
4. **Intent-based Processing**: Searches for specific data arrays by intent
5. **Data Conversion**: Transforms GIFTI data into internal `SurfaceGeometry` structure

**Code Flow**:
```rust
pub fn read_gifti_surface<P: AsRef<Path>>(path: P) -> Result<SurfaceGeometry> {
    // File existence check
    if !path.as_ref().exists() {
        return Err(NeuroSurfError::Io(...));
    }
    
    // Read using gifti-rs
    let gifti_data = gifti_read(path)?;
    
    // Convert to internal format
    convert_gifti_to_surface(gifti_data)
}
```

### 4. Data Structure Representation

**Internal Representation** (`SurfaceGeometry`):
- **Vertices**: `Array2<f64>` - N×3 coordinate array
- **Faces**: `Array2<usize>` - M×3 triangle indices
- **Graph**: `petgraph::Graph` - Connectivity representation
- **Metadata**: `HashMap<String, String>` - Additional metadata
- **Hemisphere**: Enum (`Left`, `Right`, `Both`, `Unknown`)
- **Surface Type**: Enum (`White`, `Pial`, `Inflated`, etc.)

### 5. GIFTI-Specific Metadata Handling

**Metadata Structures**:
- `GIFTISurfaceGeometryMetaInfo` - For surface geometry metadata
- `GIFTISurfaceDataMetaInfo` - For surface data metadata

**GIFTI Metadata Fields**:
```rust
pub struct GIFTISurfaceGeometryMetaInfo {
    pub gifti_version: String,           // Default: "1.0"
    pub coordinate_system: Option<String>,
    pub anatomical_structure: Option<String>,
    pub geometric_type: Option<String>,
    // ... base metadata
}

pub struct GIFTISurfaceDataMetaInfo {
    pub gifti_version: String,           // Default: "1.0"
    pub intent: String,                  // Default: "NIFTI_INTENT_SHAPE"
    pub encoding: String,                // Default: "ASCII"
    pub endian: String,                  // Default: "LittleEndian"
    // ... base metadata
}
```

### 6. Error Handling Strategy

**Error Types**:
- `NeuroSurfError::Io` - File I/O errors
- `NeuroSurfError::Custom` - GIFTI-specific parsing errors
- `NeuroSurfError::FeatureNotAvailable` - When `gifti-support` feature is disabled

**Error Scenarios**:
- File not found
- Missing coordinate data (`Intent::Pointset`)
- Missing triangle data (`Intent::Triangle`)
- Invalid data array shapes
- Data conversion failures

### 7. Writing Support

**Write Pipeline**:
1. Convert `SurfaceGeometry` to GIFTI format
2. Create coordinate data array with `Intent::Pointset`
3. Create triangle data array with `Intent::Triangle`
4. Set encoding (`GZipBase64Binary`) and data type attributes
5. Write using `gifti_write()` from `gifti-rs`

### 8. Feature Flag Architecture

**Compilation Control**:
```toml
[features]
default = ["std", "gifti-support"]
gifti-support = ["gifti"]

[dependencies]
gifti = { path = "../gifti-rs", optional = true }
```

**Runtime Behavior**:
- When `gifti-support` is enabled: Full GIFTI functionality
- When disabled: Returns `FeatureNotAvailable` error

## Critical Implementation Details

### 1. Intent-Based Content Detection

The library's approach to determining GIFTI content type relies entirely on **GIFTI Intent codes**:

- **Strength**: Standards-compliant approach following GIFTI specification
- **Limitation**: Assumes well-formed GIFTI files with proper intent codes
- **Risk**: May fail on malformed or non-standard GIFTI files

### 2. Data Conversion Strategy

**Coordinate Data**:
- Expects N×3 shape for vertex coordinates
- Converts from `Vec<f64>` to `Array2<f64>`
- No validation of coordinate ranges or units

**Triangle Data**:
- Expects M×3 shape for triangle indices
- Converts from `f64` to `usize` indices
- No validation of index bounds during conversion

### 3. Missing Functionality

**Current Limitations**:
- **TODO**: Extract hemisphere and surface type from GIFTI metadata
- **TODO**: Implement comprehensive metadata parsing
- **No Support**: Functional/scalar data arrays (only geometry)
- **Limited**: Error recovery for malformed files

## External Dependencies

### gifti-rs Library
- **Location**: `../gifti-rs` (local path dependency)
- **Purpose**: Core GIFTI XML parsing and binary data handling
- **Interface**: `read_gifti()`, `write_gifti()`, `Gifti`, `Intent`, `DataType`

## Testing Status

**Current Tests**:
- Basic error handling (`test_gifti_io`)
- File existence validation
- **Missing**: Comprehensive round-trip tests
- **Missing**: Intent detection validation
- **Missing**: Metadata extraction tests

## Integration Points

### File Format Detection
```rust
match extension {
    "gii" => {
        #[cfg(feature = "gifti-support")]
        { gifti::read_gifti_surface(path) }
        #[cfg(not(feature = "gifti-support"))]
        { Err(NeuroSurfError::feature_not_available("gifti-support")) }
    }
    // ... other formats
}
```

## Recommendations for Improvement

### 1. Enhanced Content Type Detection
- Implement multi-intent support for complex GIFTI files
- Add fallback detection methods for malformed intent codes
- Validate data array consistency

### 2. Metadata Enhancement
- Complete the TODO for extracting hemisphere/surface type from metadata
- Implement comprehensive GIFTI metadata parsing
- Add validation for coordinate systems and anatomical structures

### 3. Error Handling Improvements
- Add more specific error types for GIFTI parsing failures
- Implement recovery strategies for common malformation patterns
- Improve error messages with context about file structure

### 4. Testing Expansion
- Add comprehensive test suite with real GIFTI files
- Implement round-trip testing (read→write→read)
- Add validation tests for different GIFTI variants

## Files Examined

1. `/Users/bbuchsbaum/code/rust/neurosurf-rs/src/io/gifti.rs` - Core GIFTI implementation
2. `/Users/bbuchsbaum/code/rust/neurosurf-rs/src/io/mod.rs` - Format detection and routing
3. `/Users/bbuchsbaum/code/rust/neurosurf-rs/src/error.rs` - Error type definitions
4. `/Users/bbuchsbaum/code/rust/neurosurf-rs/src/geometry/mod.rs` - Geometry type exports
5. `/Users/bbuchsbaum/code/rust/neurosurf-rs/src/geometry/surface.rs` - Surface geometry structure
6. `/Users/bbuchsbaum/code/rust/neurosurf-rs/src/geometry/metadata.rs` - GIFTI metadata structures
7. `/Users/bbuchsbaum/code/rust/neurosurf-rs/Cargo.toml` - Dependency and feature configuration
8. `/Users/bbuchsbaum/code/rust/neurosurf-rs/src/lib.rs` - Main library interface

## Conclusion

The neurosurf-rs library implements a clean, intent-based approach to GIFTI file handling that follows neuroimaging standards. The architecture is well-designed with proper feature gating and error handling. However, the implementation is currently focused on surface geometry data and lacks support for functional data arrays. The intent-based content type determination is robust for well-formed files but may need enhancement for broader compatibility with real-world GIFTI files.

The library successfully demonstrates how to integrate external GIFTI parsing capabilities while maintaining type safety and Rust best practices through the use of feature flags, comprehensive error types, and clean abstraction boundaries.