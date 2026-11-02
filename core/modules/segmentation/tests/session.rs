use bf_segmentation::*;
use nalgebra::{Matrix4, Vector4};
use nifti::NiftiHeader;
use std::collections::BTreeSet;
fn affine() -> Matrix4<f32> {
    Matrix4::new(
        0.4, 0.0, 0.0, 10.0, 0.0, 1.6, -0.24, -20.0, 0.0, 1.2, 0.32, 5.0, 0.0, 0.0, 0.0, 1.0,
    )
}
fn setup() -> SessionSetup {
    SessionSetup {
        workspace_id: "workspace-a".into(),
        workspace_instance: "instance-a".into(),
        reference_volume_id: "reference-a".into(),
        identity: Identity {
            subject: "synthetic-01".into(),
            session: "01".into(),
            hemisphere: "left".into(),
            rater: "rater-a".into(),
            blind: true,
        },
        normal_axis: 1,
        labels: vec![
            LabelDefinition {
                id: 1,
                name: "ROI A".into(),
                abbreviation: "A".into(),
                color: [200, 100, 20],
                parent: None,
            },
            LabelDefinition {
                id: 2,
                name: "ROI B".into(),
                abbreviation: "B".into(),
                color: [20, 100, 200],
                parent: None,
            },
        ],
        secondary_volume_id: None,
        registration: None,
        reference_frame: None,
        secondary_frame: None,
    }
}
fn header() -> NiftiHeader {
    NiftiHeader {
        dim: [3, 5, 3, 7, 1, 1, 1, 1],
        ..Default::default()
    }
}
fn session() -> Session {
    Session::create("session-a".into(), setup(), affine(), header()).unwrap()
}
fn owner(s: &Session) -> Operation {
    let snapshot = s.snapshot();
    Operation {
        workspace_id: snapshot.workspace_id,
        workspace_instance: snapshot.workspace_instance,
        session_id: snapshot.session_id,
        base_revision: snapshot.revision,
    }
}
fn world(voxel: [f32; 3]) -> [f32; 3] {
    (affine() * Vector4::new(voxel[0], voxel[1], voxel[2], 1.0))
        .xyz()
        .into()
}
fn stroke(s: &Session, label: u16, points: &[[f32; 3]], radius: f32, tool: Tool) -> Stroke {
    Stroke {
        owner: owner(s),
        label_id: label,
        slice_index: 1,
        tool,
        radius_mm: radius,
        points_world: points.iter().copied().map(world).collect(),
        paint_over: PaintOver::Unlocked,
    }
}
fn set(points: Vec<[u32; 3]>) -> BTreeSet<[u32; 3]> {
    points.into_iter().collect()
}

#[test]
fn native_anisotropic_brush_has_known_world_mm_footprint_and_exact_preview_commit() {
    let mut s = session();
    let request = stroke(&s, 1, &[[2.0, 1.0, 3.0]], 0.41, Tool::Brush);
    let preview = s.preview(&request).unwrap();
    assert_eq!(
        set(preview.written.clone()),
        BTreeSet::from([[2, 1, 3], [1, 1, 3], [3, 1, 3], [2, 1, 2], [2, 1, 4]])
    );
    let (committed, change) = s.stroke(&request).unwrap();
    assert_eq!(preview.written, committed.written);
    assert_eq!(change.changed_voxels, 5);
    for voxel in preview.written {
        assert_eq!(s.volume().get(voxel).unwrap().label, 1);
        assert_eq!(s.volume().get(voxel).unwrap().provenance, 1);
    }
    assert_eq!(s.snapshot().labels[0].voxels, 5.0);
    assert!((s.snapshot().labels[0].mm3 - 1.6).abs() < 1e-6);
    let bytes = s.volume().dense().unwrap();
    s.undo(&owner(&s), false).unwrap();
    assert_eq!(s.volume().dense().unwrap(), vec![0; 105]);
    s.undo(&owner(&s), true).unwrap();
    assert_eq!(s.volume().dense().unwrap(), bytes);
}

#[test]
fn drag_capsules_fill_between_samples_and_contours_use_voxel_centres() {
    let s = session();
    let drag = stroke(
        &s,
        1,
        &[[1.0, 1.0, 3.0], [3.0, 1.0, 3.0]],
        0.15,
        Tool::Brush,
    );
    assert_eq!(
        set(s.preview(&drag).unwrap().written),
        BTreeSet::from([[1, 1, 3], [2, 1, 3], [3, 1, 3]])
    );
    let contour = stroke(
        &s,
        1,
        &[
            [0.5, 1.0, 1.5],
            [3.5, 1.0, 1.5],
            [3.5, 1.0, 4.5],
            [0.5, 1.0, 4.5],
        ],
        0.15,
        Tool::Contour,
    );
    let expected: BTreeSet<_> = (1..=3)
        .flat_map(|x| (2..=4).map(move |z| [x, 1, z]))
        .collect();
    assert_eq!(set(s.preview(&contour).unwrap().written), expected);
}

#[test]
fn all_tools_protect_locks_and_background_only_reports_the_blocked_label() {
    let mut s = session();
    let paint = stroke(&s, 2, &[[2.0, 1.0, 3.0]], 0.15, Tool::Brush);
    s.stroke(&paint).unwrap();
    s.set_label_state(&owner(&s), 2, true, true).unwrap();
    let mut paint = stroke(&s, 1, &[[2.0, 1.0, 3.0]], 0.15, Tool::Brush);
    paint.paint_over = PaintOver::All;
    let (p, change) = s.stroke(&paint).unwrap();
    assert!(p.written.is_empty());
    assert_eq!(p.blocked, [[2, 1, 3]]);
    assert_eq!(p.blocked_labels, [2]);
    assert_eq!(change.changed_voxels, 0);
    assert_eq!(s.snapshot().revision, paint.owner.base_revision);
    assert!(s
        .preview(&stroke(&s, 2, &[[2.0, 1.0, 3.0]], 0.15, Tool::Eraser))
        .is_err());
    s.set_label_state(&owner(&s), 2, false, true).unwrap();
    paint.owner = owner(&s);
    paint.paint_over = PaintOver::Background;
    assert_eq!(s.preview(&paint).unwrap().blocked_labels, [2]);
    paint.paint_over = PaintOver::Unlocked;
    s.stroke(&paint).unwrap();
    assert_eq!(s.volume().get([2, 1, 3]).unwrap().label, 1);
    let erase = stroke(&s, 2, &[[2.0, 1.0, 3.0]], 0.15, Tool::Eraser);
    assert!(
        s.preview(&erase).unwrap().written.is_empty(),
        "eraser only edits the active label"
    );
}

#[test]
fn eraser_is_active_label_local_for_every_paint_policy_and_undoes_exactly() {
    for paint_over in [PaintOver::Background, PaintOver::Unlocked, PaintOver::All] {
        let mut s = session();
        let seed = stroke(&s, 1, &[[2.0, 1.0, 3.0]], 0.41, Tool::Brush);
        s.stroke(&seed).unwrap();
        let mut other = stroke(&s, 2, &[[2.0, 1.0, 3.0]], 0.15, Tool::Brush);
        other.paint_over = PaintOver::All;
        s.stroke(&other).unwrap();
        s.set_label_state(&owner(&s), 2, true, false).unwrap();
        let before = s.volume().dense().unwrap();

        let mut erase = stroke(&s, 1, &[[2.0, 1.0, 3.0]], 0.41, Tool::Eraser);
        erase.paint_over = paint_over;
        let preview = s.preview(&erase).unwrap();
        assert_eq!(preview.written.len(), 4, "{paint_over:?}");
        assert!(preview.blocked.is_empty(), "{paint_over:?}");
        assert_eq!(s.volume().get([2, 1, 3]).unwrap().label, 2);

        let (committed, change) = s.stroke(&erase).unwrap();
        assert_eq!(committed.written, preview.written, "{paint_over:?}");
        assert_eq!(
            change.changed_voxels,
            preview.written.len(),
            "{paint_over:?}"
        );
        assert_eq!(s.volume().get([2, 1, 3]).unwrap().label, 2);
        s.undo(&owner(&s), false).unwrap();
        assert_eq!(s.volume().dense().unwrap(), before, "{paint_over:?}");
    }

    let mut s = session();
    s.set_label_state(&owner(&s), 1, true, false).unwrap();
    assert!(s
        .preview(&stroke(&s, 1, &[[2.0, 1.0, 3.0]], 0.15, Tool::Eraser))
        .is_err());
}

#[test]
fn workspace_instance_session_and_revision_are_checked_before_mutation() {
    let mut s = session();
    let request = stroke(&s, 1, &[[2.0, 1.0, 3.0]], 0.15, Tool::Brush);
    for field in ["workspace", "instance", "session", "revision"] {
        let mut wrong = request.clone();
        match field {
            "workspace" => wrong.owner.workspace_id = "other".into(),
            "instance" => wrong.owner.workspace_instance = "replacement".into(),
            "session" => wrong.owner.session_id = "other".into(),
            _ => wrong.owner.base_revision += 1,
        }
        assert!(s.stroke(&wrong).is_err());
        assert_eq!(s.snapshot().revision, 0);
        assert_eq!(s.volume().allocated_bricks(), 0);
    }
    s.stroke(&request).unwrap();
    assert!(s.stroke(&request).is_err());
}

#[test]
fn registration_starts_unconfirmed_and_records_the_actual_confirmer() {
    let mut input = setup();
    input.secondary_volume_id = Some("secondary-a".into());
    assert!(Session::create("s".into(), input.clone(), affine(), header()).is_err());
    input.registration = Some(Registration::Aligned {
        confirmer: "someone-else".into(),
        confirmed_at_ms: 123.0,
        transform_hash: "fixture-hash".into(),
        view: [0.0; 12],
    });
    assert!(Session::create("s".into(), input.clone(), affine(), header()).is_err());
    input.registration = Some(Registration::Aligned {
        confirmer: "rater-a".into(),
        confirmed_at_ms: 123.0,
        transform_hash: "fixture-hash".into(),
        view: [0.0; 12],
    });
    let s = Session::create("s".into(), input.clone(), affine(), header()).unwrap();
    assert_eq!(s.snapshot().registration, input.registration);
    input.registration = Some(Registration::WithoutSecondary {
        reason: "Trace without aids".into(),
    });
    assert!(Session::create("s".into(), input, affine(), header()).is_ok());
}

#[test]
fn malformed_tables_identity_and_strokes_are_refused() {
    let mut input = setup();
    input.labels[1].id = 1;
    assert!(Session::create("s".into(), input, affine(), header()).is_err());
    let mut input = setup();
    input.labels[0].parent = Some(2);
    input.labels[1].parent = Some(1);
    assert!(Session::create("s".into(), input, affine(), header()).is_err());
    let mut input = setup();
    input.identity.rater.clear();
    assert!(Session::create("s".into(), input, affine(), header()).is_err());
    let s = session();
    let mut request = stroke(&s, 1, &[[2.0, 1.0, 3.0]], 0.15, Tool::Brush);
    request.points_world[0][0] = f32::NAN;
    assert!(s.preview(&request).is_err());
    let request = stroke(&s, 1, &[[2.0, 0.0, 3.0]], 0.15, Tool::Brush);
    assert!(s.preview(&request).is_err());
    let request = stroke(&s, 1, &[[2.0, 1.0, 3.0]], 0.0, Tool::Brush);
    assert!(s.preview(&request).is_err());
    let request = stroke(&s, 1, &[[2.0, 1.0, 3.0]], 0.2, Tool::Contour);
    assert!(s.preview(&request).is_err());
}

#[test]
fn brush_boundary_tolerance_matches_candidate_bounds_on_translated_grids() {
    let s = session();
    let request = stroke(&s, 1, &[[2.0, 1.0, 3.0]], 0.4, Tool::Brush);
    assert_eq!(
        set(s.preview(&request).unwrap().written),
        BTreeSet::from([[2, 1, 3], [1, 1, 3], [3, 1, 3], [2, 1, 2], [2, 1, 4]])
    );
    let line = stroke(
        &s,
        1,
        &[[1.0, 1.0, 2.0], [2.0, 1.0, 2.0], [3.0, 1.0, 2.0]],
        0.4,
        Tool::Contour,
    );
    assert!(s.preview(&line).is_err());
}

#[test]
fn generated_types_are_namespaced_and_registration_fields_match_json_wire_names() {
    use ts_rs::TS;
    assert!(Snapshot::decl().starts_with("type SegmentationSnapshot"));
    let registration = Registration::decl();
    assert!(registration.contains("confirmedAtMs"), "{registration}");
    assert!(registration.contains("transformHash"), "{registration}");
    assert!(!registration.contains("confirmed_at_ms"), "{registration}");
    assert!(Stroke::decl().contains("baseRevision") || Operation::decl().contains("baseRevision"));
}

#[test]
fn ruler_matrix_and_partition_overlay_read_the_same_current_document() {
    let mut s = session();
    let request = stroke(&s, 1, &[[2.0, 1.0, 3.0]], 0.41, Tool::Brush);
    s.stroke(&request).unwrap();
    assert_eq!(s.snapshot().labels[0].slice_voxels, [0, 5, 0]);
    assert_eq!(s.slice_labels(1).unwrap().len(), 5);
    assert!(s.slice_labels(0).unwrap().is_empty());
    assert!(s.slice_labels(3).is_err());
    let p = s.native_plane(1, [5, 7], [false; 2]).unwrap();
    assert_eq!((p.width_px, p.height_px), (5, 7));
    s.undo(&owner(&s), false).unwrap();
    assert_eq!(s.snapshot().labels[0].slice_voxels, [0; 3]);
    assert!(s.slice_labels(1).unwrap().is_empty());
}

#[test]
fn derived_grids_record_the_actual_affine_without_claiming_an_original_qform() {
    let s = Session::create_on_derived_grid("derived".into(), setup(), [5, 3, 7], affine(), None)
        .unwrap();
    assert!(!s.snapshot().source_header_original);
    assert_eq!((s.header().qform_code, s.header().sform_code), (0, 2));
    assert_eq!(s.header().srow_x, [0.4, 0.0, 0.0, 10.0]);
    assert_eq!(s.header().srow_y, [0.0, 1.6, -0.24, -20.0]);
    assert!(Session::create_from_header_bytes("bad".into(), setup(), affine(), &[0; 100]).is_err());
}

#[test]
fn multi_frame_reference_is_refused_before_creating_an_ambiguous_grid() {
    let mut header = header();
    header.dim[0] = 4;
    header.dim[4] = 2;
    assert!(Session::create("refused".into(), setup(), affine(), header).is_err());
}

#[test]
fn empty_or_oversized_label_slice_metadata_is_rejected_before_snapshot_allocation() {
    let mut input = setup();
    input.labels.clear();
    assert!(Session::create("empty".into(), input, affine(), header()).is_err());
    let mut input = setup();
    let template = input.labels[0].clone();
    input.labels = (1..=1000)
        .map(|id| LabelDefinition {
            id,
            name: format!("ROI {id}"),
            parent: None,
            ..template.clone()
        })
        .collect();
    let mut grid = header();
    grid.dim[2] = 3072;
    assert!(Session::create("bounded".into(), input, affine(), grid).is_err());
}

#[test]
fn export_copies_the_accepted_revision_with_a_bids_table_and_refuses_stale_owners() {
    let mut s = session();
    let mut input = setup();
    input.labels[1].parent = Some(1);
    input.labels[1].name = "ROI\tB\n".into();
    let mut s2 = Session::create("session-b".into(), input, affine(), header()).unwrap();
    let request = stroke(&s, 1, &[[2.0, 1.0, 3.0]], 0.41, Tool::Brush);
    let stale = owner(&s);
    s.stroke(&request).unwrap();
    assert!(
        s.export(&stale).is_err(),
        "an export must match the displayed revision"
    );
    let export = s.export(&owner(&s)).unwrap();
    assert_eq!(export.revision, 1);
    assert_eq!(export.labels, s.volume().dense().unwrap());
    assert_eq!(
        export.suggested_name,
        "sub-synthetic01_ses-01_desc-ratera_dseg.nii.gz"
    );
    assert!(
        String::from_utf8_lossy(&export.header.descrip).starts_with("Brainflow segmentation r1\0")
    );
    assert_eq!(
        export.table,
        "index\tname\tabbreviation\tcolor\tparent\n1\tROI A\tA\t#c86414\tn/a\n2\tROI B\tB\t#1464c8\tn/a\n"
    );
    let export2 = s2.export(&owner(&s2)).unwrap();
    assert!(
        export2.table.ends_with("2\tROI B\tB\t#1464c8\t1\n"),
        "controls in names are sanitized and the parent index is kept: {}",
        export2.table
    );
    s2.stroke(&stroke(&s2, 2, &[[2.0, 1.0, 3.0]], 0.41, Tool::Brush))
        .unwrap();

    let directory = tempfile::tempdir().unwrap();
    let picked = directory.path().join("labels");
    let target = resolve_destination(&picked).unwrap();
    assert_eq!(target.label_path, directory.path().join("labels.nii.gz"));
    assert!(!target.replace_label && !target.replace_table);
    let saved = write_export(&export, &target).unwrap();
    assert_eq!(saved.revision, 1);
    assert_eq!(
        saved.table_path,
        directory.path().join("labels.tsv").to_string_lossy()
    );
    assert_eq!(
        std::fs::read_to_string(&saved.table_path).unwrap(),
        export.table
    );
    let object = nifti::ReaderOptions::new()
        .read_file(&target.label_path)
        .unwrap();
    use nifti::{NiftiObject, RandomAccessNiftiVolume};
    assert_eq!(object.header().intent_code, 1002);
    assert_eq!(object.volume().get_u16(&[2, 1, 3]).unwrap(), 1);
    assert_eq!(object.volume().get_u16(&[0, 0, 0]).unwrap(), 0);
    // Appending the extension never silently replaces an existing file.
    assert!(resolve_destination(&picked).is_err());
    // A confirmed path may be replaced; its table travels with it.
    let confirmed = resolve_destination(&target.label_path).unwrap();
    assert!(confirmed.replace_label && confirmed.replace_table);
    write_export(&export2, &confirmed).unwrap();
    assert_eq!(
        std::fs::read_to_string(&saved.table_path).unwrap(),
        export2.table
    );
    // A name without a NIfTI suffix gets .nii.gz appended.
    assert_eq!(
        resolve_destination(&directory.path().join("sub-01.final"))
            .unwrap()
            .label_path,
        directory.path().join("sub-01.final.nii.gz")
    );
    // Companion and other neuroimaging suffixes are refused, not extended.
    for name in [
        "labels.tsv",
        "labels.JSON",
        "labels.img",
        "labels.hdr",
        "labels.mgz",
        "labels.mgh",
    ] {
        assert!(
            resolve_destination(&directory.path().join(name)).is_err(),
            "{name}"
        );
    }
    // A table without its label volume belongs to something else.
    std::fs::write(directory.path().join("other.tsv"), "keep").unwrap();
    assert!(resolve_destination(&directory.path().join("other.nii.gz")).is_err());
    for bad in ["labels.NII.GZ", "labels.nii.bak", "labels.gz", "labels.Nii"] {
        assert!(
            resolve_destination(&directory.path().join(bad)).is_err(),
            "{bad}"
        );
    }
    assert!(resolve_destination(std::path::Path::new("relative.nii.gz")).is_err());
}

#[test]
fn a_chosen_frame_of_a_4d_reference_is_explicit_in_the_session_and_export_header() {
    let mut header = header();
    header.dim = [4, 5, 3, 7, 6, 1, 1, 1];
    header.pixdim = [1.0, 0.4, 1.6, 0.4, 2.5, 1.0, 1.0, 1.0];
    header.xyzt_units = 2 | 8; // mm, seconds
    header.toffset = 1.5;
    header.slice_code = 1;
    header.slice_end = 6;
    header.slice_duration = 0.4;
    header.dim_info = 0b11_10_01;
    header.sform_code = 2;
    header.srow_x = [0.4, 0.0, 0.0, 10.0];
    let mut input = setup();
    input.reference_frame = Some(6);
    assert!(
        Session::create("late".into(), input.clone(), affine(), header.clone()).is_err(),
        "frame 6 of six frames is out of range"
    );
    input.reference_frame = Some(3);
    input.secondary_frame = Some(1);
    assert!(
        Session::create("orphan".into(), input.clone(), affine(), header.clone()).is_err(),
        "a secondary frame needs a secondary contrast"
    );
    input.secondary_volume_id = Some("secondary-4d".into());
    input.registration = Some(Registration::WithoutSecondary {
        reason: "fixture".into(),
    });
    let mut s = Session::create("framed".into(), input.clone(), affine(), header.clone()).unwrap();
    let snapshot = s.snapshot();
    assert_eq!(
        (snapshot.reference_frame, snapshot.secondary_frame),
        (Some(3), Some(1))
    );
    assert_eq!(snapshot.dimensions, [5, 3, 7]);
    assert_eq!(
        s.header().dim,
        [3, 5, 3, 7, 1, 1, 1, 1],
        "the export grid is the 3D frame"
    );
    assert_eq!(s.header().pixdim, [1.0, 0.4, 1.6, 0.4, 1.0, 1.0, 1.0, 1.0]);
    assert_eq!(
        s.header().xyzt_units,
        2,
        "spatial units kept, temporal units cleared"
    );
    assert_eq!((s.header().toffset, s.header().slice_duration), (0.0, 0.0));
    assert_eq!((s.header().slice_code, s.header().slice_end), (0, 0));
    assert_eq!(
        s.header().dim_info,
        0b10_01,
        "frequency/phase kept, slice axis cleared"
    );
    assert_eq!(s.header().srow_x, [0.4, 0.0, 0.0, 10.0]);
    s.stroke(&stroke(&s, 1, &[[2.0, 1.0, 3.0]], 0.41, Tool::Brush))
        .unwrap();
    let export = s.export(&owner(&s)).unwrap();
    let descrip = String::from_utf8_lossy(&export.header.descrip);
    assert_eq!(
        descrip.trim_end_matches('\0'),
        "Brainflow segmentation r1; ref frame 3; sec frame 1 (0-based)"
    );
    let directory = tempfile::tempdir().unwrap();
    let destination = resolve_destination(&directory.path().join("framed_dseg.nii.gz")).unwrap();
    let saved = write_export(&export, &destination).unwrap();
    use nifti::NiftiObject;
    let written = nifti::ReaderOptions::new()
        .read_file(&saved.label_path)
        .unwrap();
    assert_eq!(written.header().dim, [3, 5, 3, 7, 1, 1, 1, 1]);
    assert!(String::from_utf8_lossy(&written.header().descrip).contains("ref frame 3"));

    // A 4D reference without a chosen frame and a 3D reference with one are refused.
    let mut unframed = setup();
    unframed.reference_frame = None;
    assert!(Session::create("unframed".into(), unframed, affine(), header).is_err());
    let mut framed3d = setup();
    framed3d.reference_frame = Some(0);
    assert!(Session::create(
        "framed3d".into(),
        framed3d.clone(),
        affine(),
        self::header()
    )
    .is_err());
    // Derived grids carry the frame count from the loaded volume.
    assert!(Session::create_on_derived_grid(
        "d".into(),
        framed3d.clone(),
        [5, 3, 7],
        affine(),
        Some(2)
    )
    .is_ok());
    assert!(
        Session::create_on_derived_grid("d".into(), framed3d, [5, 3, 7], affine(), None).is_err()
    );
}

#[test]
fn a_single_frame_4d_header_exports_as_3d_without_choosing_a_frame() {
    let mut header = header();
    header.dim = [4, 5, 3, 7, 1, 1, 1, 1];
    header.pixdim[4] = 2.0;
    header.xyzt_units = 2 | 8;
    let mut s = Session::create("single".into(), setup(), affine(), header).unwrap();
    assert_eq!(s.snapshot().reference_frame, None);
    s.stroke(&stroke(&s, 1, &[[2.0, 1.0, 3.0]], 0.41, Tool::Brush))
        .unwrap();
    let export = s.export(&owner(&s)).unwrap();
    assert_eq!(export.header.dim, [3, 5, 3, 7, 1, 1, 1, 1]);
    assert_eq!(
        (export.header.pixdim[4], export.header.xyzt_units),
        (1.0, 2)
    );
}
