use base64::{engine::general_purpose::STANDARD, Engine};
use gifti_loader::geometry::{read_labels, GeometryLimits};
use std::io::Write;
const XML: &str = include_str!("../../../../test-data/browser/octahedron.label.gii");
const TEXT: &str = "0 17 16777217 16777218 4294967295 17";
const IDS: [u32; 6] = [0, 17, 16_777_217, 16_777_218, u32::MAX, 17];

#[test]
fn exact_sparse_ids_names_and_alpha_across_encodings() {
    for encoding in ["ASCII", "Base64Binary", "GZipBase64Binary"] {
        let bytes: Vec<u8> = IDS.iter().flat_map(|id| id.to_be_bytes()).collect();
        let payload = if encoding == "GZipBase64Binary" {
            let mut zip =
                flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
            zip.write_all(&bytes).unwrap();
            STANDARD.encode(zip.finish().unwrap())
        } else if encoding == "Base64Binary" {
            STANDARD.encode(bytes)
        } else {
            TEXT.to_owned()
        };
        let xml = XML
            .replace("ASCII", encoding)
            .replace("LittleEndian", "BigEndian")
            .replace(TEXT, &payload);
        let mut zip = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        zip.write_all(xml.as_bytes()).unwrap();
        for input in [xml.as_bytes().to_vec(), zip.finish().unwrap()] {
            let map = read_labels(input.as_slice(), GeometryLimits::BROWSER).unwrap();
            assert_eq!(map.labels, IDS);
            assert_eq!(map.table[2].name, "Region & left");
            assert_eq!(map.table[2].rgba, Some([0., 1., 0., 0.5]));
            assert_eq!(map.table[3].id, u32::MAX);
            assert_eq!(map.table[3].rgba, Some([0., 0., 1., 0.]));
        }
    }
}
#[test]
fn rejects_invalid_ids_tables_and_shapes_without_rounding() {
    for (from, to) in [
        (TEXT, "0 17 0.5 16777218 4294967295 17"),
        (TEXT, "0 17 -1 16777218 4294967295 17"),
        (TEXT, "0 17 NaN 16777218 4294967295 17"),
        (TEXT, "0 17 4294967296 16777218 4294967295 17"),
        ("Key=\"17\"", "Key=\"0\""),
        ("Key=\"17\"", "Key=\"-1\""),
        ("Green=\"1\"", "Green=\"NaN\""),
        ("Alpha=\"0.5\"", "Alpha=\"1.1\""),
        ("Alpha=\"0.5\"", "Alpha=\"1.00000001\""),
        ("Alpha=\"0.5\"", "Alpha=\"-1e-100\""),
        ("Red=\"1\"", ""),
        ("Dim0=\"6\"", "Dim0=\"5\""),
        ("Dimensionality=\"1\"", "Dimensionality=\"2\" Dim1=\"2\""),
        ("NIFTI_INTENT_LABEL", "NIFTI_INTENT_NONE"),
        ("NumberOfDataArrays=\"1\"", "NumberOfDataArrays=\"2\""),
        ("ASCII", "ExternalFileBinary"),
    ] {
        assert!(
            read_labels(
                XML.replacen(from, to, 1).as_bytes(),
                GeometryLimits::BROWSER
            )
            .is_err(),
            "{to}"
        );
    }
}
#[test]
fn admits_missing_table_or_color_but_enforces_budgets() {
    let no_alpha = XML.replace(" Alpha=\"0.5\"", "");
    assert_eq!(
        read_labels(no_alpha.as_bytes(), GeometryLimits::BROWSER)
            .unwrap()
            .table[2]
            .rgba,
        Some([0., 1., 0., 1.])
    );

    let start = XML.find("<LabelTable>").unwrap();
    let end = XML.find("</LabelTable>").unwrap() + 13;
    let mut no_table = XML.to_owned();
    no_table.replace_range(start..end, "");
    assert!(read_labels(no_table.as_bytes(), GeometryLimits::BROWSER)
        .unwrap()
        .table
        .is_empty());
    let no_color = XML.replace(" Red=\"1\" Green=\"0\" Blue=\"0\" Alpha=\"1\"", "");
    assert!(read_labels(no_color.as_bytes(), GeometryLimits::BROWSER)
        .unwrap()
        .table[1]
        .rgba
        .is_none());
    for limits in [
        GeometryLimits {
            vertices: 5,
            ..GeometryLimits::BROWSER
        },
        GeometryLimits {
            input_bytes: XML.len() - 1,
            ..GeometryLimits::BROWSER
        },
    ] {
        assert!(read_labels(XML.as_bytes(), limits).is_err());
    }
    let mut zip = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
    zip.write_all(&vec![0; 100_000]).unwrap();
    let xml = XML
        .replace("ASCII", "GZipBase64Binary")
        .replace(TEXT, &STANDARD.encode(zip.finish().unwrap()));
    assert!(read_labels(xml.as_bytes(), GeometryLimits::BROWSER)
        .unwrap_err()
        .contains("byte limit"));
}
