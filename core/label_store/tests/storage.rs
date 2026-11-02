use label_store::{Error, LabelValue, LabelVolume, Region, VoxelEdit, DEFAULT_HISTORY_BYTES};
fn edit(voxel: [u32; 3], label: u16, provenance: u8) -> VoxelEdit {
    VoxelEdit {
        voxel,
        value: LabelValue { label, provenance },
    }
}

#[test]
fn sparse_bricks_and_exact_history_across_brick_boundaries() {
    let mut v = LabelVolume::new([33, 17, 2], DEFAULT_HISTORY_BYTES).unwrap();
    assert_eq!(v.allocated_bricks(), 0);
    let edits = [
        edit([0, 0, 0], 7, 1),
        edit([16, 0, 1], 301, 2),
        edit([32, 16, 1], 65535, 3),
    ];
    let change = v.commit(0, "Three labels".into(), &edits).unwrap();
    assert_eq!(change.changed_voxels, 3);
    assert_eq!(
        change.bounds,
        Some(Region {
            origin: [0, 0, 0],
            end: [33, 17, 2]
        })
    );
    assert_eq!(v.allocated_bricks(), 3);
    let after = v.dense().unwrap();
    assert_eq!(after[0], 7);
    assert_eq!(after[16 + 33 * 17], 301);
    assert_eq!(after[32 + 33 * (16 + 17)], 65535);
    v.undo(1).unwrap();
    assert_eq!(v.dense().unwrap(), vec![0; 33 * 17 * 2]);
    assert_eq!(v.allocated_bricks(), 0);
    for e in edits {
        assert_eq!(v.get(e.voxel).unwrap(), LabelValue::default());
    }
    v.redo(2).unwrap();
    assert_eq!(v.dense().unwrap(), after);
    for e in edits {
        assert_eq!(v.get(e.voxel).unwrap(), e.value);
    }
    assert_eq!(v.revision(), 3);
}

#[test]
fn validation_and_revision_failures_leave_document_and_history_intact() {
    let mut v = LabelVolume::new([2, 3, 4], DEFAULT_HISTORY_BYTES).unwrap();
    v.commit(0, "Paint".into(), &[edit([1, 2, 3], 42, 1)])
        .unwrap();
    let before = v.dense().unwrap();
    let bytes = v.history_bytes();
    assert!(matches!(
        v.commit(
            1,
            "Bad".into(),
            &[edit([0, 0, 0], 3, 1), edit([2, 0, 0], 9, 1)]
        ),
        Err(Error::Outside(_))
    ));
    assert!(matches!(v.undo(0), Err(Error::Revision { .. })));
    assert!(matches!(
        v.commit(0, "Stale".into(), &[]),
        Err(Error::Revision { .. })
    ));
    assert_eq!(v.revision(), 1);
    assert_eq!(v.dense().unwrap(), before);
    assert_eq!(v.history_bytes(), bytes);
    assert_eq!(v.undo_description(), Some("Paint"));
}

#[test]
fn duplicates_noops_and_branching_preserve_the_right_redo_history() {
    let mut v = LabelVolume::new([2, 2, 1], DEFAULT_HISTORY_BYTES).unwrap();
    v.commit(
        0,
        "first".into(),
        &[edit([1, 0, 0], 1, 1), edit([1, 0, 0], 2, 3)],
    )
    .unwrap();
    assert_eq!(
        v.get([1, 0, 0]).unwrap(),
        LabelValue {
            label: 2,
            provenance: 3
        }
    );
    v.undo(1).unwrap();
    assert!(v.commit(2, "noop".into(), &[]).unwrap().bounds.is_none());
    assert_eq!(v.redo_description(), Some("first"));
    v.commit(2, "branch".into(), &[edit([0, 0, 0], 9, 1)])
        .unwrap();
    assert!(v.redo_description().is_none());
    assert!(v.redo(3).unwrap().bounds.is_none());
    assert_eq!(v.revision(), 3);
}

#[test]
fn provenance_only_edits_and_erasing_undo_exactly() {
    let mut v = LabelVolume::from_dense([2, 1, 1], &[8, 0], DEFAULT_HISTORY_BYTES).unwrap();
    v.commit(0, "Review".into(), &[edit([0, 0, 0], 8, 4)])
        .unwrap();
    v.commit(1, "Erase".into(), &[edit([0, 0, 0], 0, 1)])
        .unwrap();
    assert_eq!(
        v.get([0, 0, 0]).unwrap(),
        LabelValue {
            label: 0,
            provenance: 1
        }
    );
    v.undo(2).unwrap();
    assert_eq!(
        v.get([0, 0, 0]).unwrap(),
        LabelValue {
            label: 8,
            provenance: 4
        }
    );
    v.undo(3).unwrap();
    assert_eq!(
        v.get([0, 0, 0]).unwrap(),
        LabelValue {
            label: 8,
            provenance: 0
        }
    );
}

#[test]
fn history_has_a_byte_budget_without_a_fixed_depth() {
    let mut v = LabelVolume::new([1, 1, 1], DEFAULT_HISTORY_BYTES).unwrap();
    for i in 0..100 {
        v.commit(i, "one".into(), &[edit([0, 0, 0], (i + 1) as u16, 1)])
            .unwrap();
    }
    for i in 100..200 {
        v.undo(i).unwrap();
    }
    assert_eq!(v.get([0, 0, 0]).unwrap(), LabelValue::default());
    let mut small = LabelVolume::new([1, 1, 1], 500).unwrap();
    for i in 0..100 {
        small
            .commit(i, "one".into(), &[edit([0, 0, 0], (i + 1) as u16, 1)])
            .unwrap();
        assert!(small.history_bytes() <= 500);
    }
    let mut count = 0;
    while small.undo_description().is_some() {
        small.undo(small.revision()).unwrap();
        count += 1;
    }
    assert!((1..100).contains(&count));
    let mut refused = LabelVolume::new([1, 1, 1], 0).unwrap();
    assert!(matches!(
        refused.commit(0, "no room".into(), &[edit([0, 0, 0], 1, 1)]),
        Err(Error::HistoryBudget)
    ));
    assert_eq!(refused.revision(), 0);
    assert_eq!(refused.allocated_bricks(), 0);
}

#[test]
fn x_fastest_region_layout_has_explicit_independent_expected_values() {
    let labels = [0, 1, 2, 10, 11, 12, 100, 101, 102, 110, 111, 112];
    let v = LabelVolume::from_dense([3, 2, 2], &labels, DEFAULT_HISTORY_BYTES).unwrap();
    assert_eq!(
        v.read_region(Region {
            origin: [1, 0, 0],
            end: [3, 2, 2]
        })
        .unwrap(),
        [1, 2, 11, 12, 101, 102, 111, 112]
    );
    assert!(v
        .read_region(Region {
            origin: [2, 0, 0],
            end: [1, 2, 2]
        })
        .is_err());
    assert!(LabelVolume::new([0, 1, 1], 500).is_err());
    assert!(LabelVolume::new([32768, 1, 1], 500).is_err());
    assert!(LabelVolume::from_dense([3, 2, 2], &[1], 500).is_err());
}

#[test]
fn counts_and_range_follow_overwrites_provenance_undo_and_redo() {
    let mut v = LabelVolume::from_dense([2, 1, 1], &[8, 301], DEFAULT_HISTORY_BYTES).unwrap();
    assert_eq!(v.data_range(), (8, 301));
    assert_eq!(
        v.label_counts()
            .iter()
            .map(|(&id, &count)| (id, count))
            .collect::<Vec<_>>(),
        [(8, 1), (301, 1)]
    );
    v.commit(0, "Erase".into(), &[edit([1, 0, 0], 0, 1)])
        .unwrap();
    assert_eq!(v.data_range(), (0, 8));
    assert!(!v.label_counts().contains_key(&301));
    v.undo(1).unwrap();
    assert_eq!(v.data_range(), (8, 301));
    v.redo(2).unwrap();
    assert_eq!(v.data_range(), (0, 8));
    v.commit(3, "Reassign".into(), &[edit([1, 0, 0], 8, 1)])
        .unwrap();
    assert_eq!(v.data_range(), (8, 8));
    assert_eq!(v.label_counts().get(&8), Some(&2));
    v.commit(4, "Provenance".into(), &[edit([1, 0, 0], 8, 3)])
        .unwrap();
    assert_eq!(v.label_counts().get(&8), Some(&2));
}

#[test]
fn sparse_iteration_keeps_native_coordinates_and_omits_background_provenance() {
    let mut v = LabelVolume::new([33, 17, 2], DEFAULT_HISTORY_BYTES).unwrap();
    v.commit(
        0,
        "Paint".into(),
        &[
            edit([32, 16, 1], 301, 1),
            edit([1, 0, 0], 7, 3),
            edit([16, 0, 1], 0, 4),
        ],
    )
    .unwrap();
    let mut actual: Vec<_> = v.label_voxels().collect();
    actual.sort_by_key(|(voxel, _)| *voxel);
    assert_eq!(
        actual,
        [
            (
                [1, 0, 0],
                LabelValue {
                    label: 7,
                    provenance: 3
                }
            ),
            (
                [32, 16, 1],
                LabelValue {
                    label: 301,
                    provenance: 1
                }
            )
        ]
    );
}
