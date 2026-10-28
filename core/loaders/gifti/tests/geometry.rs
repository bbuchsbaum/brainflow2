use gifti_loader::geometry::read_surface;
use std::io::{self, Read};
const XML: &str = include_str!("../../../../test-data/browser/octahedron.surf.gii");
const EXPECTED: [f32; 18] = [
    10., 80., 30., 10., -40., 30., -30., 20., 30., 50., 20., 30., 10., 20., 110., 10., 20., -50.,
];

#[test]
fn independent_world_geometry_across_encodings_order_and_compression() {
    for bytes in [
        XML.as_bytes(),
        include_bytes!("../../../../test-data/browser/octahedron-column.surf.gii"),
        include_bytes!("../../../../test-data/browser/octahedron-zlib.surf.gii"),
        include_bytes!("../../../../test-data/browser/octahedron.surf.gii.gz"),
    ] {
        let mesh = read_surface(bytes).unwrap();
        assert_eq!(mesh.vertices_world(), EXPECTED);
        assert_eq!(
            mesh.faces,
            [0, 2, 4, 2, 1, 4, 1, 3, 4, 3, 0, 4, 2, 0, 5, 1, 2, 5, 3, 1, 5, 0, 3, 5]
        );
        assert_eq!(mesh.hemisphere, "left");
    }
}

#[test]
fn rejects_invalid_indices_affines_dimensions_and_external_data() {
    for (old, new, reason) in [
        ("<Data>0 2 4", "<Data>6 2 4", "indices"),
        ("<Data>0 2 4", "<Data>0.5 2 4", "indices"),
        ("<Data>20 0 0", "<Data>NaN 0 0", "finite"),
        ("<Data>0 2 4", "<Data>0 0 4", "degenerate"),
        ("0 0 0 1</MatrixData>", "0 0 0 0</MatrixData>", "affine"),
        ("Dim0=\"6\"", "Dim0=\"1000001\"", "rows"),
        (
            "Encoding=\"ASCII\"",
            "Encoding=\"ExternalFileBinary\"",
            "self-contained",
        ),
    ] {
        let bad = XML.replacen(old, new, 1);
        assert_ne!(bad, XML);
        assert!(
            read_surface(bad.as_bytes()).unwrap_err().contains(reason),
            "{reason}"
        );
    }
}

#[test]
fn compressed_payload_cannot_expand_past_declared_shape() {
    use base64::Engine;
    use std::io::Write;
    let mut zlib = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
    zlib.write_all(&vec![0; 100_000]).unwrap();
    let payload = base64::engine::general_purpose::STANDARD.encode(zlib.finish().unwrap());
    let start = XML.find("<Data>").unwrap() + 6;
    let end = XML[start..].find("</Data>").unwrap() + start;
    let mut bad = XML.to_owned();
    bad.replace_range(start..end, &payload);
    bad = bad.replacen("Encoding=\"ASCII\"", "Encoding=\"GZipBase64Binary\"", 1);
    assert!(read_surface(bad.as_bytes())
        .unwrap_err()
        .contains("byte limit"));
}

#[test]
fn propagates_aborted_reads() {
    struct Aborted;
    impl Read for Aborted {
        fn read(&mut self, _: &mut [u8]) -> io::Result<usize> {
            Err(io::Error::other("cancelled source"))
        }
    }
    assert!(read_surface(Aborted)
        .unwrap_err()
        .contains("cancelled source"));
}

#[cfg(feature = "desktop")]
#[test]
fn desktop_adapter_uses_same_geometry_and_transform() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../test-data/browser/octahedron-column.surf.gii");
    let surface = gifti_loader::load_gifti_surface(&path).unwrap();
    let world = surface.vertices_world().unwrap();
    assert_eq!(
        world.iter().map(|v| *v as f32).collect::<Vec<_>>(),
        EXPECTED
    );
    assert_eq!(surface.face_count(), 8);
}

#[test]
fn host_limits_do_not_change_decoding() {
    use gifti_loader::geometry::{read_surface_with_limits, GeometryLimits};
    let tight = GeometryLimits {
        input_bytes: XML.len(),
        vertices: 5,
        faces: 8,
    };
    assert!(read_surface_with_limits(XML.as_bytes(), tight)
        .unwrap_err()
        .contains("rows"));
    let admitted = GeometryLimits {
        vertices: 6,
        ..tight
    };
    assert_eq!(
        read_surface_with_limits(XML.as_bytes(), admitted)
            .unwrap()
            .vertices_world(),
        EXPECTED
    );
}
