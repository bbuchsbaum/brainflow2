use label_store::{write_label_nifti, LabelVolume, DEFAULT_HISTORY_BYTES};
use nifti::{NiftiHeader, NiftiObject, RandomAccessNiftiVolume, ReaderOptions};
use std::io::Read;

fn reference() -> NiftiHeader {
    NiftiHeader {
        dim: [3, 3, 2, 4, 1, 1, 1, 1],
        pixdim: [-1.0, 0.4, 0.5, 2.0, 1.0, 1.0, 1.0, 1.0],
        qform_code: 1,
        sform_code: 4,
        quatern_b: 0.0,
        quatern_c: 0.0,
        quatern_d: std::f32::consts::FRAC_1_SQRT_2,
        quatern_x: 12.0,
        quatern_y: -18.0,
        quatern_z: 7.0,
        srow_x: [0.4, 0.0, 0.0, -3.0],
        srow_y: [0.0, 0.3, -1.6, 13.0],
        srow_z: [0.0, 0.4, 1.2, -23.0],
        xyzt_units: 2,
        scl_slope: 2.0,
        scl_inter: 100.0,
        ..NiftiHeader::default()
    }
}
#[test]
fn atomic_gzip_and_plain_exports_keep_both_transforms_and_integer_values() {
    let directory = tempfile::tempdir().unwrap();
    for (maximum, dtype, bitpix) in [(255, 2i16, 8i16), (256, 512, 16), (65535, 512, 16)] {
        let mut values = vec![0; 24];
        values[1] = 7;
        values[11] = maximum;
        values[23] = 1;
        let v = LabelVolume::from_dense([3, 2, 4], &values, DEFAULT_HISTORY_BYTES).unwrap();
        for suffix in ["nii", "nii.gz"] {
            let path = directory.path().join(format!("labels-{maximum}.{suffix}"));
            std::fs::write(&path, b"old destination").unwrap();
            let reference = reference();
            write_label_nifti(&v, &reference, &path).unwrap();
            let obj = ReaderOptions::new().read_file(&path).unwrap();
            let h = obj.header();
            assert_eq!(h.dim, [3, 3, 2, 4, 1, 1, 1, 1]);
            assert_eq!((h.datatype, h.bitpix, h.intent_code), (dtype, bitpix, 1002));
            assert_eq!((h.scl_slope, h.scl_inter), (1.0, 0.0));
            assert_eq!(h.pixdim, reference.pixdim);
            assert_eq!(h.xyzt_units, reference.xyzt_units);
            assert_eq!((h.qform_code, h.sform_code), (1, 4));
            assert_eq!(
                (h.quatern_b, h.quatern_c, h.quatern_d),
                (
                    reference.quatern_b,
                    reference.quatern_c,
                    reference.quatern_d
                )
            );
            assert_eq!((h.quatern_x, h.quatern_y, h.quatern_z), (12.0, -18.0, 7.0));
            assert_eq!(
                (h.srow_x, h.srow_y, h.srow_z),
                (reference.srow_x, reference.srow_y, reference.srow_z)
            );
            // Independent library reader checks all positions on a non-cubic grid.
            for z in 0..4 {
                for y in 0..2 {
                    for x in 0..3 {
                        assert_eq!(
                            obj.volume().get_u16(&[x, y, z]).unwrap(),
                            values[x as usize + 3 * (y as usize + 2 * z as usize)]
                        );
                    }
                }
            }
            // Raw file bytes independently confirm intent, dtype, and x-fastest order.
            let file = std::fs::read(&path).unwrap();
            let mut plain = Vec::new();
            if suffix.ends_with("gz") {
                assert_eq!(&file[..2], &[31, 139]);
                flate2::read::GzDecoder::new(&file[..])
                    .read_to_end(&mut plain)
                    .unwrap();
            } else {
                plain = file;
            }
            assert_eq!(i16::from_le_bytes(plain[68..70].try_into().unwrap()), 1002);
            let offset = f32::from_le_bytes(plain[108..112].try_into().unwrap()) as usize;
            let read: Vec<u16> = if bitpix == 8 {
                plain[offset..].iter().map(|&b| u16::from(b)).collect()
            } else {
                plain[offset..]
                    .chunks_exact(2)
                    .map(|b| u16::from_le_bytes([b[0], b[1]]))
                    .collect()
            };
            assert_eq!(read, values);
            assert_eq!(
                std::fs::read_dir(directory.path())
                    .unwrap()
                    .filter_map(|p| p.ok())
                    .filter(|p| p
                        .file_name()
                        .to_string_lossy()
                        .starts_with(".brainflow-labels-"))
                    .count(),
                0
            );
        }
    }
}

#[test]
fn refused_export_keeps_existing_file_and_cleans_temporary_files() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("labels.nii.gz");
    std::fs::write(&path, b"keep me").unwrap();
    let v = LabelVolume::new([2, 2, 2], DEFAULT_HISTORY_BYTES).unwrap();
    assert!(write_label_nifti(&v, &reference(), &path).is_err());
    assert_eq!(std::fs::read(&path).unwrap(), b"keep me");
    assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
    assert!(write_label_nifti(&v, &reference(), &directory.path().join("labels.img")).is_err());
}
