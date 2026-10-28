use base64::{engine::general_purpose::STANDARD, Engine};
use gifti_loader::geometry::{read_scalar, read_scalar_with_limits, GeometryLimits};
use std::io::Write;
const XML: &str = include_str!("../../../../test-data/browser/octahedron.func.gii");
const VALUES: [f32; 6] = [-3., -1., 0., 2., 4., 8.];

#[test]
fn scalar_values_across_encodings_and_file_compression() {
    assert_eq!(read_scalar(XML.as_bytes()).unwrap(), VALUES);
    for encoding in ["Base64Binary", "GZipBase64Binary"] {
        let raw: Vec<u8> = VALUES.iter().flat_map(|v| v.to_be_bytes()).collect();
        let payload = if encoding == "GZipBase64Binary" {
            let mut zip =
                flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
            zip.write_all(&raw).unwrap();
            zip.finish().unwrap()
        } else {
            raw
        };
        let xml = XML
            .replace("ASCII", encoding)
            .replace("LittleEndian", "BigEndian")
            .replace("-3 -1 0 2 4 8", &STANDARD.encode(payload))
            .replace("RowMajorOrder", "ColumnMajorOrder")
            .replace("Dimensionality=\"1\"", "Dimensionality=\"2\" Dim1=\"1\"");
        assert_eq!(read_scalar(xml.as_bytes()).unwrap(), VALUES);
        let mut zip = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        zip.write_all(xml.as_bytes()).unwrap();
        assert_eq!(
            read_scalar(zip.finish().unwrap().as_slice()).unwrap(),
            VALUES
        );
    }
}
#[test]
fn rejects_ambiguous_missing_nonfinite_and_wrong_shape_maps() {
    for (old, new) in [
        ("-3 -1 0 2 4 8", "-3 -1 NaN 2 4 8"),
        ("-3 -1 0 2 4 8", "-3 -1 inf 2 4 8"),
        ("-3 -1 0 2 4 8", "-3 -1 1e100 2 4 8"),
        ("-3 -1 0 2 4 8", "-3 -1 0 2 4"),
        ("Dim0=\"6\"", "Dim0=\"0\""),
        ("Dimensionality=\"1\"", "Dimensionality=\"2\" Dim1=\"2\""),
        ("NIFTI_INTENT_TTEST", "NIFTI_INTENT_LABEL"),
        ("NIFTI_INTENT_TTEST", "NIFTI_INTENT_POINTSET"),
        ("ASCII", "ExternalFileBinary"),
    ] {
        assert!(
            read_scalar(XML.replace(old, new).as_bytes()).is_err(),
            "{new}"
        );
    }
    let array = XML
        .split("<DataArray")
        .nth(1)
        .unwrap()
        .split("</DataArray>")
        .next()
        .unwrap();
    let multiple = XML
        .replace("NumberOfDataArrays=\"1\"", "NumberOfDataArrays=\"2\"")
        .replace(
            "</GIFTI>",
            &format!("<DataArray{array}</DataArray></GIFTI>"),
        );
    assert!(read_scalar(multiple.as_bytes())
        .unwrap_err()
        .contains("ambiguous"));
}
#[test]
fn input_and_expanded_array_limits_precede_decode() {
    assert!(read_scalar_with_limits(
        XML.as_bytes(),
        GeometryLimits {
            vertices: 5,
            ..GeometryLimits::BROWSER
        }
    )
    .is_err());
    assert!(read_scalar_with_limits(
        XML.as_bytes(),
        GeometryLimits {
            input_bytes: XML.len() - 1,
            ..GeometryLimits::BROWSER
        }
    )
    .is_err());
    let mut zip = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
    zip.write_all(&vec![0; 100_000]).unwrap();
    let xml = XML
        .replace("ASCII", "GZipBase64Binary")
        .replace("-3 -1 0 2 4 8", &STANDARD.encode(zip.finish().unwrap()));
    assert!(read_scalar(xml.as_bytes())
        .unwrap_err()
        .contains("byte limit"));
    struct Failed;
    impl std::io::Read for Failed {
        fn read(&mut self, _: &mut [u8]) -> std::io::Result<usize> {
            Err(std::io::Error::other("cancelled"))
        }
    }
    assert!(read_scalar(Failed).unwrap_err().contains("cancelled"));
}
#[cfg(feature = "desktop")]
#[test]
fn desktop_scalar_values_agree_with_portable_decoder() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../test-data/browser/octahedron.func.gii");
    assert_eq!(
        gifti_loader::load_gifti_surface_data(&path).unwrap(),
        VALUES
    );
}

#[cfg(feature = "desktop")]
#[test]
fn desktop_preserves_labels_missing_values_and_first_array_semantics() {
    let array = XML
        .split("<DataArray")
        .nth(1)
        .unwrap()
        .split("</DataArray>")
        .next()
        .unwrap();
    let multiple = XML
        .replace("NumberOfDataArrays=\"1\"", "NumberOfDataArrays=\"2\"")
        .replace(
            "</GIFTI>",
            &format!("<DataArray{array}</DataArray></GIFTI>"),
        );
    for (name, xml) in [
        (
            "labels",
            XML.replace("NIFTI_INTENT_TTEST", "NIFTI_INTENT_LABEL"),
        ),
        (
            "missing",
            XML.replace("-3 -1 0 2 4 8", "-3 NaN inf -inf 4 8"),
        ),
        ("first", multiple),
        (
            "matrix",
            XML.replace(
                "Dimensionality=\"1\" Dim0=\"6\"",
                "Dimensionality=\"2\" Dim0=\"3\" Dim1=\"2\"",
            ),
        ),
    ] {
        let path =
            std::env::temp_dir().join(format!("brainflow-gifti-{}-{name}.gii", std::process::id()));
        std::fs::write(&path, &xml).unwrap();
        let result = gifti_loader::load_gifti_surface_data(&path);
        std::fs::remove_file(path).unwrap();
        let values = result.unwrap();
        if name == "missing" {
            assert!(values[1].is_nan());
            assert_eq!(values[2], f32::INFINITY);
            assert_eq!(values[3], f32::NEG_INFINITY);
        } else {
            assert_eq!(values, VALUES);
        }
        assert!(
            read_scalar(xml.as_bytes()).is_err(),
            "browser contract remains strict: {name}"
        );
    }
}
