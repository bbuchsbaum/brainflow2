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
    let s =
        Session::create_on_derived_grid("derived".into(), setup(), [5, 3, 7], affine()).unwrap();
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
