//! Bounded, filesystem-free GIfTI geometry. Encodings use the gifti crate's
//! decoder; this layer preserves array order and transforms it currently drops.
use base64::{engine::general_purpose::STANDARD, Engine};
use gifti::{DataType, Encoding, Endianness, Intent};
use nalgebra::{Matrix4, Vector4};
use serde::Deserialize;
use std::io::Read;

pub const MAX_INPUT_BYTES: usize = 64 * 1024 * 1024;
pub const MAX_VERTICES: usize = 1_000_000;
pub const MAX_FACES: usize = 2_000_000;

/// Admission belongs to the host, while decoding and validation remain shared.
#[derive(Clone, Copy)]
pub struct GeometryLimits {
    pub input_bytes: usize,
    pub vertices: usize,
    pub faces: usize,
}
impl GeometryLimits {
    pub const BROWSER: Self = Self {
        input_bytes: MAX_INPUT_BYTES,
        vertices: MAX_VERTICES,
        faces: MAX_FACES,
    };
    /// Preserve desktop capacity; checked shape arithmetic still prevents overflow.
    pub const DESKTOP: Self = Self {
        input_bytes: usize::MAX - 1,
        vertices: u32::MAX as usize,
        faces: usize::MAX / 3,
    };
}

#[derive(Debug)]
pub struct SurfaceMesh {
    pub vertices: Vec<f64>,
    pub faces: Vec<u32>,
    pub surf_to_world: Matrix4<f64>,
    pub hemisphere: String,
    pub surface_type: String,
}
impl SurfaceMesh {
    pub fn vertices_world(&self) -> Vec<f32> {
        self.vertices
            .chunks_exact(3)
            .flat_map(|v| {
                let p = self.surf_to_world * Vector4::new(v[0], v[1], v[2], 1.);
                [p.x as f32, p.y as f32, p.z as f32]
            })
            .collect()
    }
}

#[derive(Deserialize)]
struct Document {
    #[serde(rename = "@Version")]
    version: String,
    #[serde(rename = "@NumberOfDataArrays")]
    count: usize,
    #[serde(rename = "MetaData", default)]
    metadata: Metadata,
    #[serde(rename = "DataArray", default)]
    arrays: Vec<Array>,
}
#[derive(Default, Deserialize)]
struct Metadata {
    #[serde(rename = "MD", default)]
    entries: Vec<MetaEntry>,
}
#[derive(Deserialize)]
struct MetaEntry {
    #[serde(rename = "Name")]
    name: String,
    #[serde(rename = "Value", default)]
    value: String,
}
#[derive(Deserialize)]
struct Transform {
    #[serde(rename = "MatrixData")]
    matrix: String,
}
#[derive(Deserialize)]
struct Array {
    #[serde(rename = "@Intent")]
    intent: String,
    #[serde(rename = "@DataType")]
    datatype: String,
    #[serde(rename = "@Encoding")]
    encoding: String,
    #[serde(rename = "@Endian")]
    endian: String,
    #[serde(rename = "@ArrayIndexingOrder", default)]
    order: String,
    #[serde(rename = "@Dimensionality")]
    dimensions: usize,
    #[serde(rename = "@Dim0")]
    rows: usize,
    #[serde(rename = "@Dim1", default)]
    columns: usize,
    #[serde(rename = "MetaData", default)]
    metadata: Metadata,
    #[serde(rename = "CoordinateSystemTransformMatrix", default)]
    transforms: Vec<Transform>,
    #[serde(rename = "Data", default)]
    data: String,
}
fn limited(reader: impl Read, limit: usize) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    reader
        .take(limit.saturating_add(1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > limit {
        return Err(format!("GIfTI data exceeds {limit} byte limit"));
    }
    Ok(bytes)
}

/// Decode one self-contained geometry file. Does not read external data paths.
/// Both compressed file bytes and expanded XML are bounded to 64 MiB.
pub fn read_surface(reader: impl Read) -> Result<SurfaceMesh, String> {
    read_surface_with_limits(reader, GeometryLimits::BROWSER)
}

pub fn read_surface_with_limits(
    reader: impl Read,
    limits: GeometryLimits,
) -> Result<SurfaceMesh, String> {
    let bytes = limited(reader, limits.input_bytes)?;
    let xml = if bytes.starts_with(&[0x1f, 0x8b]) {
        limited(
            flate2::read::GzDecoder::new(bytes.as_slice()),
            limits.input_bytes,
        )?
    } else {
        bytes
    };
    let xml = std::str::from_utf8(&xml).map_err(|e| e.to_string())?;
    let doc: Document = quick_xml::de::from_str(xml).map_err(|e| e.to_string())?;
    if doc.version != "1.0" || doc.count != doc.arrays.len() {
        return Err("Expected GIfTI 1.0 with a matching declared array count".into());
    }
    let mut points = None;
    let mut triangles = None;
    for array in &doc.arrays {
        match array.intent.parse::<Intent>().map_err(|e| e.to_string())? {
            Intent::Pointset => {
                if points.replace(array).is_some() {
                    return Err("Multiple POINTSET arrays are ambiguous".into());
                }
            }
            Intent::Triangle => {
                if triangles.replace(array).is_some() {
                    return Err("Multiple TRIANGLE arrays are ambiguous".into());
                }
            }
            _ => {} // Geometry workflow ignores accompanying scalar arrays.
        }
    }
    let points = points.ok_or("GIfTI has no POINTSET geometry")?;
    let triangles = triangles.ok_or("GIfTI has no TRIANGLE geometry")?;
    let vertices = decode(points, limits.vertices)?;
    let indices = decode(triangles, limits.faces)?;
    if points.transforms.len() > 1 {
        return Err("Multiple coordinate transforms are ambiguous".into());
    }
    let surf_to_world = if let Some(transform) = points.transforms.first() {
        let values = transform
            .matrix
            .split_whitespace()
            .map(str::parse::<f64>)
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        if values.len() != 16 {
            return Err("Coordinate transform requires 16 values".into());
        }
        Matrix4::from_row_slice(&values)
    } else {
        Matrix4::identity()
    };
    if !surf_to_world.iter().all(|v| v.is_finite())
        || surf_to_world.row(3).iter().copied().collect::<Vec<_>>() != [0., 0., 0., 1.]
        || surf_to_world.try_inverse().is_none()
    {
        return Err("Surface transform must be a finite, nonsingular affine".into());
    }
    let mut faces = Vec::with_capacity(indices.len());
    for value in indices {
        if !value.is_finite() || value.fract() != 0. || value < 0. || value >= points.rows as f64 {
            return Err("Triangle indices must be integers inside the vertex array".into());
        }
        faces.push(value as u32);
    }
    let metadata = |key: &str| {
        points
            .metadata
            .entries
            .iter()
            .chain(&doc.metadata.entries)
            .find(|entry| entry.name == key)
            .map(|entry| entry.value.to_lowercase())
            .unwrap_or_default()
    };
    let anatomy = metadata("AnatomicalStructurePrimary");
    let hemisphere = if anatomy.contains("left") {
        "left"
    } else if anatomy.contains("right") {
        "right"
    } else {
        "unknown"
    }
    .to_owned();
    let secondary = metadata("AnatomicalStructureSecondary");
    let geometric = metadata("GeometricType");
    let surface_type = if secondary.contains("pial") {
        "pial"
    } else if secondary.contains("midthickness") {
        "midthickness"
    } else if secondary.contains("white") || secondary.contains("smoothwm") {
        "white"
    } else if geometric.contains("inflated") {
        "inflated"
    } else if geometric.contains("spher") {
        "spherical"
    } else if geometric.contains("flat") {
        "flat"
    } else {
        "white"
    }
    .to_owned();
    let mesh = SurfaceMesh {
        vertices,
        faces,
        surf_to_world,
        hemisphere,
        surface_type,
    };
    let world = mesh.vertices_world();
    if !mesh.vertices.iter().all(|v| v.is_finite()) || !world.iter().all(|v| v.is_finite()) {
        return Err("Surface coordinates must be finite and representable as f32".into());
    }
    for face in mesh.faces.chunks_exact(3) {
        let p = |i: u32| {
            nalgebra::Vector3::new(
                world[i as usize * 3] as f64,
                world[i as usize * 3 + 1] as f64,
                world[i as usize * 3 + 2] as f64,
            )
        };
        if (p(face[1]) - p(face[0]))
            .cross(&(p(face[2]) - p(face[0])))
            .norm_squared()
            == 0.
        {
            return Err("Surface contains a degenerate triangle".into());
        }
    }
    Ok(mesh)
}

fn decode(array: &Array, max_rows: usize) -> Result<Vec<f64>, String> {
    if array.dimensions != 2 || array.columns != 3 || array.rows == 0 || array.rows > max_rows {
        return Err(format!(
            "Geometry array must be N x 3 with 1..{max_rows} rows"
        ));
    }
    let count = array
        .rows
        .checked_mul(3)
        .ok_or("Geometry shape overflows addressable memory")?;
    let dtype: DataType = array
        .datatype
        .parse()
        .map_err(|e: gifti::GiftiError| e.to_string())?;
    let encoding: Encoding = array
        .encoding
        .parse()
        .map_err(|e: gifti::GiftiError| e.to_string())?;
    let endian: Endianness = array
        .endian
        .parse()
        .map_err(|e: gifti::GiftiError| e.to_string())?;
    let expected_bytes = count
        .checked_mul(dtype.size_bytes())
        .ok_or("Geometry size overflows addressable memory")?;
    let data = if encoding == Encoding::GZipBase64Binary {
        let compressed = STANDARD
            .decode(array.data.split_whitespace().collect::<String>())
            .map_err(|e| e.to_string())?;
        // Bound decompression BEFORE the existing decoder sees the payload.
        let bytes = if compressed.starts_with(&[0x1f, 0x8b]) {
            limited(
                flate2::read::GzDecoder::new(compressed.as_slice()),
                expected_bytes,
            )?
        } else {
            limited(
                flate2::read::ZlibDecoder::new(compressed.as_slice()),
                expected_bytes,
            )?
        };
        gifti::io::decoder::decode_data(
            &STANDARD.encode(bytes),
            Encoding::Base64Binary,
            dtype,
            endian,
            None,
            count,
        )
    } else if matches!(encoding, Encoding::Ascii | Encoding::Base64Binary) {
        if encoding == Encoding::Ascii
            && array
                .data
                .split_whitespace()
                .take(count.saturating_add(1))
                .count()
                != count
        {
            return Err("Geometry data length does not match its declared shape".into());
        }
        gifti::io::decoder::decode_data(&array.data, encoding, dtype, endian, None, count)
    } else {
        return Err("Select a self-contained GIfTI; external binary data is unsupported".into());
    }
    .map_err(|e| e.to_string())?;
    match array.order.as_str() {
        "" | "RowMajorOrder" => Ok(data),
        "ColumnMajorOrder" => Ok((0..array.rows)
            .flat_map(|row| (0..3).map(move |col| (row, col)))
            .map(|(row, col)| data[col * array.rows + row])
            .collect()),
        _ => Err("Unsupported GIfTI array indexing order".into()),
    }
}
