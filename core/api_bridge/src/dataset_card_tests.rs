//! Local coverage of the dataset-card probes, on trees built in a temporary
//! folder. The remote path is covered in `remote_transfer_tests.rs`.

use super::*;
use std::fs;

/// A temporary tree, removed on drop.
struct Tree(PathBuf);

impl Tree {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("brainflow-cards-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        // Compare and contain against the real path (`/tmp` is a link on macOS).
        Self(fs::canonicalize(root).unwrap())
    }
    fn path(&self, rel: &str) -> PathBuf {
        self.0.join(rel)
    }
    fn text(&self, rel: &str) -> String {
        self.path(rel).to_string_lossy().into_owned()
    }
    fn dir(&self, rel: &str) -> &Self {
        fs::create_dir_all(self.path(rel)).unwrap();
        self
    }
    fn file(&self, rel: &str, content: impl AsRef<[u8]>) -> &Self {
        let path = self.path(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, content).unwrap();
        self
    }
    /// Empty files stand in for images: only their names are counted.
    fn images(&self, rels: &[&str]) -> &Self {
        for rel in rels {
            self.file(rel, b"");
        }
        self
    }
}

impl Drop for Tree {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

async fn card_of(tree: &Tree, rel: &str) -> DatasetCard {
    card_with(tree, rel, WalkCaps::default()).await
}

async fn card_with(tree: &Tree, rel: &str, caps: WalkCaps) -> DatasetCard {
    let folder = tree.path(rel);
    let entries = CardFs::Local.list(&folder).await.unwrap();
    build_card(&CardFs::Local, &folder, &tree.0, entries, caps)
        .await
        .card
}

/// A plain NIfTI-1 header: 8×8×4, 2 mm, int16.
fn nifti_header() -> Vec<u8> {
    let mut header = vec![0u8; 352];
    header[0..4].copy_from_slice(&348i32.to_le_bytes());
    for (i, dim) in [3i16, 8, 8, 4].iter().enumerate() {
        header[40 + 2 * i..42 + 2 * i].copy_from_slice(&dim.to_le_bytes());
    }
    header[70..72].copy_from_slice(&4i16.to_le_bytes());
    header[72..74].copy_from_slice(&16i16.to_le_bytes());
    for i in 1..=3 {
        header[76 + 4 * i..80 + 4 * i].copy_from_slice(&2.0f32.to_le_bytes());
    }
    header[108..112].copy_from_slice(&352.0f32.to_le_bytes());
    header[344..348].copy_from_slice(b"n+1\0");
    header
}

fn other<'a>(description: &'a DatasetDescription, key: &str) -> Option<&'a DatasetOtherField> {
    description.other_fields.iter().find(|f| f.key == key)
}

// ---- description ----

#[test]
fn description_keeps_standard_fields_and_shows_unknown_keys() {
    let long = "x".repeat(MAX_VALUE_CHARS + 50);
    let text = serde_json::json!({
        "Name": "Encoding study",
        "BIDSVersion": "1.9.0",
        "DatasetType": "derivative",
        "License": "CC0",
        "Authors": ["A. One", "B. Two"],
        "Acknowledgements": "thanks",
        "HowToAcknowledge": "cite us",
        "Funding": ["Grant 1"],
        "EthicsApprovals": ["REB 7"],
        "ReferencesAndLinks": ["https://example.org"],
        "DatasetDOI": "doi:10.1/x",
        "HEDVersion": "8.2.0",
        "Description": "free text",
        "GeneratedBy": [{
            "Name": "fmriprep",
            "Version": "24.1.1",
            "Description": "preprocessing",
            "CodeURL": "https://example.org/code",
            "Container": {"Type": "docker", "Tag": "nipreps/fmriprep:24.1.1", "URI": "docker://x"}
        }, {"Name": "custom"}],
        "SourceDatasets": [{"URL": "file://../", "DOI": "doi:10.1/raw", "Version": "1.0.2"}],
        "PipelineSettings": {"smoothing_fwhm": 6, "confounds": ["csf", "wm"]},
        "LabNote": long,
    })
    .to_string();
    let parsed = parse_description(text.as_bytes(), false);
    assert_eq!(parsed.issue, None);
    let d = parsed.description.unwrap();
    assert_eq!(d.name.as_deref(), Some("Encoding study"));
    assert_eq!(d.bids_version.as_deref(), Some("1.9.0"));
    assert_eq!(d.dataset_type.as_deref(), Some("derivative"));
    assert_eq!(d.license.as_deref(), Some("CC0"));
    assert_eq!(d.authors, ["A. One", "B. Two"]);
    assert_eq!(d.acknowledgements.as_deref(), Some("thanks"));
    assert_eq!(d.how_to_acknowledge.as_deref(), Some("cite us"));
    assert_eq!(d.funding, ["Grant 1"]);
    assert_eq!(d.ethics_approvals, ["REB 7"]);
    assert_eq!(d.references_and_links, ["https://example.org"]);
    assert_eq!(d.dataset_doi.as_deref(), Some("doi:10.1/x"));
    assert_eq!(d.hed_version, ["8.2.0"]);
    assert_eq!(d.description.as_deref(), Some("free text"));
    assert_eq!(d.generated_by.len(), 2);
    let first = &d.generated_by[0];
    assert_eq!(first.name.as_deref(), Some("fmriprep"));
    assert_eq!(first.version.as_deref(), Some("24.1.1"));
    assert_eq!(first.description.as_deref(), Some("preprocessing"));
    assert_eq!(first.code_url.as_deref(), Some("https://example.org/code"));
    let container = first.container.as_ref().unwrap();
    assert_eq!(container.container_type.as_deref(), Some("docker"));
    assert_eq!(container.tag.as_deref(), Some("nipreps/fmriprep:24.1.1"));
    assert_eq!(container.uri.as_deref(), Some("docker://x"));
    assert_eq!(d.source_datasets[0].url.as_deref(), Some("file://../"));
    assert_eq!(d.source_datasets[0].doi.as_deref(), Some("doi:10.1/raw"));
    assert_eq!(d.source_datasets[0].version.as_deref(), Some("1.0.2"));

    // Unknown keys stay visible, compact and bounded.
    assert_eq!(d.other_fields.len(), 2);
    let settings = other(&d, "PipelineSettings").unwrap();
    assert_eq!(
        settings.value,
        r#"{"confounds":["csf","wm"],"smoothing_fwhm":6}"#
    );
    assert!(!settings.truncated);
    let note = other(&d, "LabNote").unwrap();
    assert!(note.truncated);
    assert_eq!(note.value.chars().count(), MAX_VALUE_CHARS);

    assert_eq!(
        marker_summary(&d),
        DatasetMarkerSummary {
            name: Some("Encoding study".into()),
            dataset_type: Some("derivative".into()),
            generated_by: Some(DatasetPipelineRef {
                name: "fmriprep".into(),
                version: Some("24.1.1".into()),
            }),
        }
    );
    // The container type is `type` on the wire.
    let wire = serde_json::to_value(&d).unwrap();
    assert_eq!(wire["generatedBy"][0]["container"]["type"], "docker");
    assert_eq!(
        wire["generatedBy"][0]["codeUrl"],
        "https://example.org/code"
    );
    assert_eq!(wire["otherFields"][1]["key"], "PipelineSettings");
    assert_eq!(wire["otherFields"][1]["truncated"], false);
}

#[test]
fn description_survives_wrong_shapes_and_syntax_errors() {
    // A standard key with the wrong shape is not lost: it is shown as written.
    let odd = br#"{"Name": 7, "Authors": "Solo Author", "License": {"id": "CC0"},
        "GeneratedBy": "fmriprep", "SourceDatasets": {"URL": "x"}}"#;
    let parsed = parse_description(odd, false);
    let d = parsed.description.unwrap();
    assert_eq!(d.name.as_deref(), Some("7"));
    assert_eq!(d.authors, ["Solo Author"]);
    assert_eq!(d.license, None);
    assert_eq!(other(&d, "License").unwrap().value, r#"{"id":"CC0"}"#);
    assert_eq!(other(&d, "GeneratedBy").unwrap().value, r#""fmriprep""#);
    // Other fields keep the order they have in the file.
    let keys: Vec<&str> = d.other_fields.iter().map(|f| f.key.as_str()).collect();
    assert_eq!(keys, ["License", "GeneratedBy"]);
    assert_eq!(d.source_datasets[0].url.as_deref(), Some("x"));
    let issue = parsed.issue.unwrap();
    assert!(issue.contains("License, GeneratedBy"), "{issue}");

    // A syntax error keeps the fields before it and says where it is.
    let broken = b"{\"Name\": \"Half\", \"DatasetType\": \"raw\",\n \"Authors\": [\"A\" \"B\"]}";
    let parsed = parse_description(broken, false);
    let d = parsed.description.unwrap();
    assert_eq!(d.name.as_deref(), Some("Half"));
    assert_eq!(d.dataset_type.as_deref(), Some("raw"));
    assert!(d.authors.is_empty());
    let issue = parsed.issue.unwrap();
    assert!(issue.contains("invalid JSON"), "{issue}");
    assert!(issue.contains("line 2"), "{issue}");
    assert!(issue.contains("2 field(s)"), "{issue}");

    // Nothing usable: no description, and a reason.
    for bytes in [&b"not json"[..], b"[1, 2]", b""] {
        let parsed = parse_description(bytes, false);
        assert!(parsed.description.is_none());
        assert!(parsed.issue.unwrap().contains("invalid JSON"));
    }

    // A byte-order mark is not a syntax error.
    let parsed = parse_description("\u{feff}{\"Name\": \"Marked\"}".as_bytes(), false);
    assert_eq!(parsed.issue, None);
    assert_eq!(parsed.description.unwrap().name.as_deref(), Some("Marked"));

    // A file longer than the read is reported as such, not as bad JSON.
    let parsed = parse_description(b"{\"Name\": \"Long\", \"Pad\": \"aaaa", true);
    assert_eq!(parsed.description.unwrap().name.as_deref(), Some("Long"));
    assert!(parsed.issue.unwrap().contains("larger than 1024 KiB"));
}

#[tokio::test]
async fn card_reads_description_and_reports_a_missing_or_broken_one() {
    let tree = Tree::new();
    tree.file(
        "good/dataset_description.json",
        r#"{"Name": "Good", "BIDSVersion": "1.9.0", "Custom": [1, 2]}"#,
    )
    .file("broken/dataset_description.json", r#"{"Name": "Cut", "#)
    .dir("none");

    let good = card_of(&tree, "good").await;
    assert!(good.has_description);
    assert_eq!(good.folder_name, "good");
    assert_eq!(good.description_issue, None);
    let description = good.description.unwrap();
    assert_eq!(description.name.as_deref(), Some("Good"));
    assert_eq!(other(&description, "Custom").unwrap().value, "[1,2]");
    let path = tree.text("good/dataset_description.json");
    assert_eq!(good.description_path.as_deref(), Some(path.as_str()));
    assert_eq!(
        good.description_raw.as_deref(),
        Some(r#"{"Name": "Good", "BIDSVersion": "1.9.0", "Custom": [1, 2]}"#)
    );
    assert!(!good.description_raw_truncated);
    assert_eq!(good.source_paths, [path]);

    let broken = card_of(&tree, "broken").await;
    assert!(broken.has_description);
    assert_eq!(broken.description.unwrap().name.as_deref(), Some("Cut"));
    assert!(broken.description_issue.unwrap().contains("invalid JSON"));
    assert_eq!(
        broken.description_raw.as_deref(),
        Some(r#"{"Name": "Cut", "#)
    );

    let none = card_of(&tree, "none").await;
    assert!(!none.has_description);
    assert!(none.description.is_none());
    assert_eq!(none.description_issue, None);
    assert_eq!(none.description_path, None);
    assert_eq!(none.description_raw, None);
    assert!(none.readme.is_none());
    assert!(none.source_paths.is_empty());
    assert_eq!(none.contents, DatasetContents::default());
}

// ---- README ----

#[tokio::test]
async fn readme_precedence_cap_and_truncation() {
    let tree = Tree::new();
    tree.file("all/README", "plain")
        .file("all/README.md", "# markdown")
        .file("all/README.rst", "rst")
        .file("all/README.txt", "txt")
        .file("md/README.md", "# markdown")
        .file("md/README.txt", "txt")
        .file("rst/README.txt", "txt")
        .file("rst/README.rst", "rst")
        .file("txt/README.txt", "txt")
        .file("txt/NOTES.md", "not a readme")
        .file("lower/readme.md", "lower case")
        .file("big/README", "é".repeat(MAX_README_BYTES as usize))
        .file("edge/README", "a".repeat(MAX_README_BYTES as usize));

    for (folder, name, text) in [
        ("all", "README", "plain"),
        ("md", "README.md", "# markdown"),
        ("rst", "README.rst", "rst"),
        ("txt", "README.txt", "txt"),
        ("lower", "readme.md", "lower case"),
    ] {
        let readme = card_of(&tree, folder).await.readme.unwrap();
        assert_eq!(
            (readme.file_name.as_str(), readme.text.as_str()),
            (name, text)
        );
        assert_eq!(readme.path, tree.text(&format!("{folder}/{name}")));
        assert!(!readme.truncated);
    }

    // Twice the cap on disk: the text stops at the cap and says so.
    let big = card_of(&tree, "big").await;
    let readme = big.readme.unwrap();
    assert!(readme.truncated);
    assert!(readme.text.len() <= MAX_README_BYTES as usize + 3);
    assert!(readme.text.starts_with("éé"));
    assert_eq!(big.source_paths, [tree.text("big/README")]);

    // Exactly the cap is whole.
    let edge = card_of(&tree, "edge").await.readme.unwrap();
    assert!(!edge.truncated);
    assert_eq!(edge.text.len(), MAX_README_BYTES as usize);
}

// ---- contents ----

#[tokio::test]
async fn contents_are_counted_from_a_bids_tree() {
    let tree = Tree::new();
    tree.file("ds/dataset_description.json", r#"{"Name": "Raw"}"#)
        .file("ds/participants.tsv", "participant_id\n")
        .file(
            "ds/sub-01/ses-pre/func/sub-01_ses-pre_task-rest_bold.json",
            "{}",
        )
        .images(&[
            "ds/sub-01/ses-pre/anat/sub-01_ses-pre_T1w.nii.gz",
            "ds/sub-01/ses-pre/func/sub-01_ses-pre_task-rest_run-1_bold.nii.gz",
            "ds/sub-01/ses-pre/func/sub-01_ses-pre_task-rest_run-2_bold.nii.gz",
            "ds/sub-01/ses-post/func/sub-01_ses-post_task-nback_bold.nii.gz",
            "ds/sub-02/ses-pre/anat/sub-02_ses-pre_T1w.nii.gz",
            "ds/sub-02/ses-pre/func/sub-02_ses-pre_task-rest_run-1_bold.nii.gz",
            "ds/sub-02/ses-pre/func/sub-02_ses-pre_task-rest_space-MNI152NLin2009cAsym_bold.nii",
            "ds/sub-02/ses-pre/func/sub-02_ses-pre_hemi-L_space-fsaverage_bold.func.gii",
            // Not part of this dataset: its derivatives, and trees no scan reads.
            "ds/derivatives/fmriprep/sub-01/anat/sub-01_desc-preproc_T1w.nii.gz",
            "ds/sourcedata/sub-09/raw.nii.gz",
            "ds/.git/annex/objects/x.nii.gz",
        ])
        // A subject with no images still counts.
        .dir("ds/sub-03");

    let contents = card_of(&tree, "ds").await.contents;
    assert_eq!(contents.subject_count, 3);
    assert_eq!(contents.session_count, 2);
    assert_eq!(contents.tasks, ["nback", "rest"]);
    assert_eq!(contents.spaces, ["MNI152NLin2009cAsym", "fsaverage"]);
    assert_eq!(contents.image_count, 8);
    assert!(!contents.has_group_level);
    assert_eq!(contents.group_image_count, 0);
    assert!(!contents.truncated);
    assert_eq!(contents.truncated_reason, None);
    // Subject, session and run labels are normalized out of a kind.
    assert_eq!(contents.image_kind_count, 5);
    assert_eq!(
        contents.image_kinds[0],
        DatasetImageKind {
            path: "ses-*/func/sub-*_ses-*_task-rest_run-*_bold.nii.gz".into(),
            count: 3,
            subject_folders: Some(3),
        }
    );
    assert_eq!(
        contents.image_kinds[1],
        DatasetImageKind {
            path: "ses-*/anat/sub-*_ses-*_T1w.nii.gz".into(),
            count: 2,
            subject_folders: Some(3),
        }
    );
}

#[tokio::test]
async fn image_kinds_describe_a_derivative_that_is_not_entity_named() {
    let tree = Tree::new();
    let mut images = Vec::new();
    for subject in ["01", "02", "03"] {
        for rel in [
            "enc_rep/maps/same_item.nii.gz",
            "enc_rep/maps/diff_item.nii.gz",
            "enc_rep/mask.nii",
        ] {
            images.push(format!("rsa/sub-{subject}/{rel}"));
        }
    }
    images.push("rsa/sub-03/ret/maps/same_item.nii.gz".into());
    let images: Vec<&str> = images.iter().map(String::as_str).collect();
    tree.images(&images)
        .file("rsa/sub-01/enc_rep/maps/notes.txt", "not an image");

    let contents = card_of(&tree, "rsa").await.contents;
    assert_eq!(contents.subject_count, 3);
    assert_eq!(contents.session_count, 0);
    assert!(contents.tasks.is_empty() && contents.spaces.is_empty());
    assert_eq!(contents.image_count, 10);
    assert!(!contents.has_group_level);
    let kinds: Vec<(&str, u32)> = contents
        .image_kinds
        .iter()
        .map(|kind| (kind.path.as_str(), kind.count))
        .collect();
    assert_eq!(
        kinds,
        [
            ("enc_rep/maps/diff_item.nii.gz", 3),
            ("enc_rep/maps/same_item.nii.gz", 3),
            ("enc_rep/mask.nii", 3),
            ("ret/maps/same_item.nii.gz", 1),
        ]
    );
    assert_eq!(contents.image_kind_count, 4);

    // A flat folder of per-subject files has subjects too, from their names.
    let flat = Tree::new();
    flat.images(&[
        "stats/sub-01_stat.nii.gz",
        "stats/sub-02_stat.nii.gz",
        "stats/mean_stat.nii.gz",
    ]);
    let contents = card_of(&flat, "stats").await.contents;
    assert_eq!(contents.subject_count, 2);
    assert_eq!(
        contents.image_kinds,
        [DatasetImageKind {
            path: "sub-*_stat.nii.gz".into(),
            count: 2,
            // Subjects known from file names only: nothing to expect of them.
            subject_folders: None,
        }]
    );
    assert!(contents.has_group_level);
    assert_eq!(contents.group_image_count, 1);
}

#[tokio::test]
async fn more_kinds_than_the_card_lists_are_counted() {
    let tree = Tree::new();
    let images: Vec<String> = (0..MAX_IMAGE_KINDS + 6)
        .map(|i| format!("many/sub-01/maps/contrast{i:02}.nii.gz"))
        .collect();
    let images: Vec<&str> = images.iter().map(String::as_str).collect();
    tree.images(&images);
    let contents = card_of(&tree, "many").await.contents;
    assert_eq!(contents.image_kinds.len(), MAX_IMAGE_KINDS);
    assert_eq!(contents.image_kind_count as usize, MAX_IMAGE_KINDS + 6);
    assert_eq!(contents.image_kinds[0].path, "maps/contrast00.nii.gz");
    // Every kind was seen, so nothing about the counts is uncertain.
    assert!(!contents.truncated);
}

#[tokio::test]
async fn a_group_folder_or_images_outside_subjects_is_a_group_level() {
    let tree = Tree::new();
    tree.images(&[
        "with_group/sub-01/stat.nii.gz",
        "with_group/group/mean.nii.gz",
        "loose/sub-01/stat.nii.gz",
        "loose/second_level/tmap.nii.gz",
        "subjects_only/sub-01/stat.nii.gz",
    ])
    .dir("empty_group/group")
    .images(&["empty_group/sub-01/stat.nii.gz"]);

    let with_group = card_of(&tree, "with_group").await.contents;
    assert!(with_group.has_group_level);
    assert_eq!(with_group.group_image_count, 1);
    assert_eq!(with_group.image_count, 2);
    assert_eq!(with_group.subject_count, 1);

    let loose = card_of(&tree, "loose").await.contents;
    assert!(loose.has_group_level);
    assert_eq!(loose.group_image_count, 1);

    let empty_group = card_of(&tree, "empty_group").await.contents;
    assert!(empty_group.has_group_level);
    assert_eq!(empty_group.group_image_count, 0);

    assert!(
        !card_of(&tree, "subjects_only")
            .await
            .contents
            .has_group_level
    );
}

#[tokio::test]
async fn a_walk_that_meets_a_bound_says_its_counts_are_a_minimum() {
    let tree = Tree::new();
    let mut images = Vec::new();
    for subject in 0..12 {
        for run in 0..4 {
            images.push(format!("big/sub-{subject:02}/func/run{run}.nii.gz"));
        }
    }
    images.push("big/sub-00/a/b/c/d/deep.nii.gz".into());
    let images: Vec<&str> = images.iter().map(String::as_str).collect();
    tree.images(&images);
    let exact = card_of(&tree, "big").await.contents;
    assert!(!exact.truncated);
    assert_eq!((exact.subject_count, exact.image_count), (12, 49));

    let caps = WalkCaps::default();
    // Folder bound: the subjects are still all seen in the root listing.
    let few_dirs = card_with(
        &tree,
        "big",
        WalkCaps {
            max_dirs: 6,
            ..caps
        },
    )
    .await
    .contents;
    assert!(few_dirs.truncated);
    assert!(few_dirs
        .truncated_reason
        .as_deref()
        .unwrap()
        .contains("more than 6 folders"));
    assert_eq!(few_dirs.subject_count, 12);
    assert!(few_dirs.image_count < 49);

    let few_entries = card_with(
        &tree,
        "big",
        WalkCaps {
            max_entries: 20,
            ..caps
        },
    )
    .await
    .contents;
    assert!(few_entries.truncated);
    assert!(few_entries
        .truncated_reason
        .as_deref()
        .unwrap()
        .contains("more than 20 entries"));
    assert!(few_entries.image_count < 49);

    let shallow = card_with(
        &tree,
        "big",
        WalkCaps {
            max_depth: 3,
            ..caps
        },
    )
    .await
    .contents;
    assert!(shallow.truncated);
    assert!(shallow
        .truncated_reason
        .as_deref()
        .unwrap()
        .contains("below 3 levels"));
    assert_eq!(shallow.image_count, 48);

    let no_time = card_with(
        &tree,
        "big",
        WalkCaps {
            budget: Duration::ZERO,
            ..caps
        },
    )
    .await
    .contents;
    assert!(no_time.truncated);
    assert!(no_time
        .truncated_reason
        .as_deref()
        .unwrap()
        .contains("took longer"));
    assert_eq!(no_time.subject_count, 12);
}

// ---- analyses ----

fn analyses_tree(tree: &Tree, base: &str) {
    tree.file(
        &format!("{base}/glm/dataset_description.json"),
        r#"{"Name": "First-level GLM", "GeneratedBy": [{"Name": "fitlins", "Version": "0.11.0"}]}"#,
    )
    .images(&[
        &format!("{base}/glm/sub-01/maps/zstat.nii.gz"),
        &format!("{base}/glm/sub-02/maps/zstat.nii.gz"),
        &format!("{base}/glm/group/mean_zstat.nii.gz"),
        // No description: still an analysis, by its subjects.
        &format!("{base}/rsa/sub-01/enc/item.nii.gz"),
        &format!("{base}/rsa/sub-02/enc/item.nii.gz"),
        &format!("{base}/rsa/sub-03/enc/item.nii.gz"),
        // Neither a description nor subjects: not an analysis.
        &format!("{base}/scratch/tmp.nii.gz"),
    ])
    .file(
        &format!("{base}/described/dataset_description.json"),
        r#"{"Name": "Templates only", "GeneratedBy": "by hand"#,
    )
    .dir(&format!("{base}/.cache/sub-01"))
    // `code` is never an analysis, whatever it holds.
    .file(&format!("{base}/code/dataset_description.json"), "{}");
}

fn check_analyses(card: &DatasetCard, parent: &Path) {
    assert_eq!(card.analyses_path.as_deref(), Some(&*shown(parent)));
    assert!(!card.analyses_truncated);
    let names: Vec<&str> = card
        .analyses
        .iter()
        .map(|analysis| analysis.folder_name.as_str())
        .collect();
    assert_eq!(names, ["described", "glm", "rsa"]);

    let described = &card.analyses[0];
    assert!(described.has_description);
    assert_eq!(described.title.as_deref(), Some("Templates only"));
    assert_eq!(described.generated_by, None);
    assert_eq!(described.subject_count, 0);
    assert!(!described.has_group_level);
    assert!(described.issue.as_deref().unwrap().contains("invalid JSON"));

    let glm = &card.analyses[1];
    assert_eq!(glm.path, shown(&parent.join("glm")));
    assert_eq!(glm.title.as_deref(), Some("First-level GLM"));
    assert_eq!(
        glm.generated_by,
        Some(DatasetPipelineRef {
            name: "fitlins".into(),
            version: Some("0.11.0".into()),
        })
    );
    assert_eq!(glm.subject_count, 2);
    assert!(glm.has_group_level && glm.has_description);
    assert_eq!(glm.issue, None);

    let rsa = &card.analyses[2];
    assert!(!rsa.has_description);
    assert_eq!((rsa.title.as_deref(), &rsa.generated_by), (None, &None));
    assert_eq!(rsa.subject_count, 3);
    assert!(!rsa.has_group_level);

    for name in ["described", "glm"] {
        let path = shown(&parent.join(name).join(DESCRIPTION));
        assert!(card.source_paths.contains(&path), "{path}");
    }
}

#[tokio::test]
async fn analyses_are_found_directly_and_under_derivatives() {
    let tree = Tree::new();
    analyses_tree(&tree, "direct");
    let direct = card_of(&tree, "direct").await;
    check_analyses(&direct, &tree.path("direct"));
    // A folder of analyses holds no images of its own beyond the loose ones.
    assert_eq!(direct.contents.subject_count, 0);
    assert_eq!(direct.contents.image_count, 1);

    analyses_tree(&tree, "study/derivatives");
    tree.file("study/dataset_description.json", r#"{"Name": "Study"}"#)
        .images(&["study/sub-01/anat/sub-01_T1w.nii.gz"]);
    let study = card_of(&tree, "study").await;
    check_analyses(&study, &tree.path("study/derivatives"));
    // The raw dataset's own counts leave its derivatives out.
    assert_eq!(study.contents.subject_count, 1);
    assert_eq!(study.contents.image_count, 1);

    // The derivatives folder itself is a folder of analyses.
    let derivatives = card_of(&tree, "study/derivatives").await;
    check_analyses(&derivatives, &tree.path("study/derivatives"));

    // A dataset with subjects and no derivatives has no analyses: its
    // subject folders are not probed as if they were.
    let plain = card_of(&tree, "study/derivatives/rsa").await;
    assert!(plain.analyses.is_empty());
    assert_eq!(plain.analyses_path, None);
    assert_eq!(plain.contents.subject_count, 3);
}

#[tokio::test]
async fn analyses_beyond_the_bound_are_reported_as_truncated() {
    let tree = Tree::new();
    for i in 0..5 {
        tree.dir(&format!("many/analysis{i}/sub-01"));
    }
    let folder = tree.path("many");
    let entries = CardFs::Local.list(&folder).await.unwrap();
    let scan = scan_analyses(&CardFs::Local, &folder, &entries, 3)
        .await
        .scan
        .unwrap();
    assert!(scan.truncated);
    assert_eq!(scan.children.len(), 3);
    assert_eq!(scan.children[0].name, "analysis0");
}

// ---- markers ----

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn markers_report_descriptions_and_analysis_counts() {
    let tree = Tree::new();
    analyses_tree(&tree, "study/derivatives");
    tree.file(
        "study/dataset_description.json",
        r#"{"Name": "Study", "DatasetType": "raw"}"#,
    )
    .images(&["study/sub-01/anat/sub-01_T1w.nii.gz"])
    .dir("plain");
    let state = BridgeState::default().unwrap();
    let asked = vec![
        tree.text("study"),
        tree.text("study/derivatives"),
        tree.text("study/derivatives/glm"),
        tree.text("study/derivatives/described"),
        tree.text("plain"),
        tree.text("absent"),
        // The same folder, asked for with a trailing separator.
        format!("{}/", tree.text("study")),
    ];
    let markers = markers_impl(&state, asked.clone(), Some(tree.text("")))
        .await
        .unwrap();
    assert_eq!(markers.len(), asked.len());
    for (marker, asked) in markers.iter().zip(&asked) {
        assert_eq!(&marker.path, asked);
    }

    let study = &markers[0];
    assert!(study.has_description);
    assert_eq!(study.analysis_count, Some(3));
    assert!(!study.analysis_count_truncated);
    assert_eq!(
        study.summary,
        Some(DatasetMarkerSummary {
            name: Some("Study".into()),
            dataset_type: Some("raw".into()),
            generated_by: None,
        })
    );
    assert_eq!(study.issue, None);

    let derivatives = &markers[1];
    assert!(!derivatives.has_description);
    assert_eq!(derivatives.analysis_count, Some(3));
    assert_eq!(derivatives.summary, None);

    let glm = &markers[2];
    assert!(glm.has_description);
    assert_eq!(glm.analysis_count, None);
    let summary = glm.summary.as_ref().unwrap();
    assert_eq!(summary.name.as_deref(), Some("First-level GLM"));
    assert_eq!(summary.generated_by.as_ref().unwrap().name, "fitlins");
    assert_eq!(
        summary.generated_by.as_ref().unwrap().version.as_deref(),
        Some("0.11.0")
    );

    // A broken description still gives what parsed, with the reason.
    let described = &markers[3];
    assert!(described.has_description);
    assert_eq!(
        described.summary.as_ref().unwrap().name.as_deref(),
        Some("Templates only")
    );
    assert!(described.issue.as_deref().unwrap().contains("invalid JSON"));

    let plain = &markers[4];
    assert!(!plain.has_description && plain.analysis_count.is_none() && plain.issue.is_none());

    // One unreadable folder does not fail the others.
    let absent = &markers[5];
    assert!(!absent.has_description);
    assert!(absent
        .issue
        .as_deref()
        .unwrap()
        .contains("could not be read"));

    assert_eq!(markers[6].summary, study.summary);

    // Asked again at once, the answers come from the cache: a change on disk
    // is not seen inside the freshness window, and no folder is read.
    fs::remove_file(tree.path("study/dataset_description.json")).unwrap();
    let again = markers_impl(&state, vec![tree.text("study")], Some(tree.text("")))
        .await
        .unwrap();
    assert!(again[0].has_description);
    // A folder that failed is not cached, so it is seen once it exists.
    tree.file("absent/dataset_description.json", r#"{"Name": "Now here"}"#);
    let appeared = markers_impl(&state, vec![tree.text("absent")], Some(tree.text("")))
        .await
        .unwrap();
    assert_eq!(
        appeared[0].summary.as_ref().unwrap().name.as_deref(),
        Some("Now here")
    );

    let too_many = vec![tree.text("plain"); MAX_MARKER_PATHS + 1];
    let error = markers_impl(&state, too_many, None).await.unwrap_err();
    assert!(matches!(error, BridgeError::Input { code: 8264, .. }));
}

#[tokio::test]
async fn a_marker_is_reused_only_while_its_folder_listing_is_unchanged() {
    let tree = Tree::new();
    tree.file("ds/dataset_description.json", r#"{"Name": "Before"}"#);
    let folder = tree.path("ds");
    let fs_ = CardFs::Local;
    let first = probe_marker(&fs_, &folder, &tree.0, "asked", None).await;
    assert!(!first.reused);
    let name = |probe: &MarkerProbe| probe.marker.summary.as_ref().unwrap().name.clone();
    assert_eq!(name(&first).as_deref(), Some("Before"));
    let cached = Some((first.marker.clone(), first.stamp.unwrap()));

    let same = probe_marker(&fs_, &folder, &tree.0, "asked", cached.clone()).await;
    assert!(same.reused);
    assert_eq!(same.stamp, first.stamp);

    // A rewritten description changes the listing's size, so it is read again.
    tree.file("ds/dataset_description.json", r#"{"Name": "Afterwards"}"#);
    let changed = probe_marker(&fs_, &folder, &tree.0, "asked", cached.clone()).await;
    assert!(!changed.reused);
    assert_eq!(name(&changed).as_deref(), Some("Afterwards"));
    assert_ne!(changed.stamp, first.stamp);

    // So does a new child folder.
    let cached = Some((changed.marker.clone(), changed.stamp.unwrap()));
    tree.dir("ds/derivatives/glm/sub-01");
    let grown = probe_marker(&fs_, &folder, &tree.0, "asked", cached).await;
    assert!(!grown.reused);
    assert_eq!(grown.marker.analysis_count, Some(1));
}

// ---- sidecars ----

fn chain(levels: &[(&str, &[&str])]) -> Vec<(PathBuf, Vec<String>)> {
    levels
        .iter()
        .map(|(dir, names)| {
            (
                PathBuf::from(dir),
                names.iter().map(|name| name.to_string()).collect(),
            )
        })
        .collect()
}

fn applied(
    file: &str,
    levels: &[(&str, &[&str])],
    root: Option<&str>,
) -> Vec<(String, SidecarLevel)> {
    applicable_sidecars(file, &chain(levels), root.map(Path::new))
        .0
        .into_iter()
        .map(|sidecar| (shown(&sidecar.path), sidecar.level))
        .collect()
}

#[test]
fn sidecars_apply_by_suffix_and_entity_subset() {
    use SidecarLevel::*;
    let file = "sub-01_ses-pre_task-rest_run-1_bold.nii.gz";
    let levels: &[(&str, &[&str])] = &[
        (
            "/ds",
            &[
                "dataset_description.json",
                "participants.json",
                "task-rest_bold.json",
                // Another task, another suffix, another subject: none apply.
                "task-nback_bold.json",
                "task-rest_events.json",
                "sub-02_task-rest_bold.json",
                "bold.json",
                "notes.txt",
            ],
        ),
        (
            "/ds/sub-01",
            &["sub-01_task-rest_bold.json", "sub-01_T1w.json"],
        ),
        (
            "/ds/sub-01/ses-pre",
            &["sub-01_ses-pre_task-rest_bold.json"],
        ),
        (
            "/ds/sub-01/ses-pre/func",
            &[
                "sub-01_ses-pre_task-rest_run-1_bold.json",
                "sub-01_ses-pre_task-rest_bold.json",
                "sub-01_ses-pre_task-rest_run-2_bold.json",
            ],
        ),
    ];
    assert_eq!(
        applied(file, levels, Some("/ds")),
        [
            // Farthest first; in one folder the less specific comes first.
            ("/ds/bold.json".to_string(), Dataset),
            ("/ds/task-rest_bold.json".to_string(), Dataset),
            ("/ds/sub-01/sub-01_task-rest_bold.json".to_string(), Subject),
            (
                "/ds/sub-01/ses-pre/sub-01_ses-pre_task-rest_bold.json".to_string(),
                Session
            ),
            (
                "/ds/sub-01/ses-pre/func/sub-01_ses-pre_task-rest_bold.json".to_string(),
                Directory
            ),
            (
                "/ds/sub-01/ses-pre/func/sub-01_ses-pre_task-rest_run-1_bold.json".to_string(),
                File
            ),
        ]
    );
    // With no dataset root the top folder is only a folder.
    assert_eq!(applied(file, &levels[..1], None)[0].1, Directory);

    // A file that is not entities and a suffix takes its own sidecar only:
    // `item.json` and `other_item.json` would both pass a bare suffix match.
    let loose: &[(&str, &[&str])] = &[
        ("/ds", &["item.json", "same_item.json"]),
        (
            "/ds/sub-01/maps",
            &[
                "same_item.json",
                "item.json",
                "other_item.json",
                "diff_item.json",
            ],
        ),
    ];
    assert_eq!(
        applied("same_item.nii.gz", loose, Some("/ds")),
        [("/ds/sub-01/maps/same_item.json".to_string(), File)]
    );
    assert!(applied("lonely.nii", loose, Some("/ds")).is_empty());

    assert_eq!(own_sidecar_names("a_bold.nii.gz"), ["a_bold.json"]);
    assert_eq!(own_sidecar_names("a_bold.nii"), ["a_bold.json"]);
    assert_eq!(
        own_sidecar_names("sub-01_hemi-L_bold.func.gii"),
        ["sub-01_hemi-L_bold.func.json", "sub-01_hemi-L_bold.json"]
    );
    assert_eq!(
        own_sidecar_names("zstat1.feat.nii.gz"),
        ["zstat1.feat.json"]
    );

    // More sidecars than are read: the nearest are kept.
    let names: Vec<String> = (0..MAX_SIDECAR_FILES + 4)
        .map(|i| format!("acq-{i:02}x_bold.json"))
        .collect();
    let crowded = vec![
        (PathBuf::from("/ds"), vec!["bold.json".to_string()]),
        (PathBuf::from("/ds/sub-01"), {
            let mut names = names.clone();
            names.push("sub-01_bold.json".into());
            names
        }),
    ];
    let (kept, truncated) = applicable_sidecars("sub-01_bold.nii.gz", &crowded, None);
    assert!(!truncated);
    assert_eq!(kept.len(), 2);
    let many: Vec<(PathBuf, Vec<String>)> = (0..MAX_SIDECAR_FILES + 2)
        .map(|i| {
            (
                PathBuf::from(format!("/l{i}")),
                vec!["bold.json".to_string()],
            )
        })
        .collect();
    let (kept, truncated) = applicable_sidecars("sub-01_bold.nii.gz", &many, None);
    assert!(truncated);
    assert_eq!(kept.len(), MAX_SIDECAR_FILES);
    assert_eq!(kept[0].path, PathBuf::from("/l2/bold.json"));
}

#[tokio::test]
async fn sidecar_card_merges_nearer_over_farther_and_reads_the_header() {
    let tree = Tree::new();
    let image = "ds/sub-01/func/sub-01_task-rest_bold.nii";
    tree.file("ds/dataset_description.json", r#"{"Name": "Raw"}"#)
        .file(
            "ds/task-rest_bold.json",
            r#"{"RepetitionTime": 2.0, "EchoTime": 0.02, "TaskName": "rest", "Institution": "A"}"#,
        )
        .file(
            "ds/sub-01/sub-01_task-rest_bold.json",
            r#"{"EchoTime": 0.025, "Institution": "B"}"#,
        )
        .file(
            "ds/sub-01/func/sub-01_task-rest_bold.json",
            r#"{"EchoTime": 0.03, "SliceTiming": [0.0, 0.5, 1.0]}"#,
        )
        .file(
            "ds/sub-01/func/sub-01_task-nback_bold.json",
            r#"{"EchoTime": 9}"#,
        )
        // Above the dataset root: never part of the merge.
        .file("bold.json", r#"{"Outside": true}"#)
        .file(image, nifti_header());

    let card = build_sidecar_card(&CardFs::Local, &tree.path(image), Some(&tree.0))
        .await
        .unwrap();
    assert_eq!(card.path, tree.text(image));
    assert_eq!(card.file_name, "sub-01_task-rest_bold.nii");
    assert!(card.entity_named);
    assert_eq!(card.dataset_root, Some(tree.text("ds")));
    assert!(card.issues.is_empty(), "{:?}", card.issues);
    assert!(!card.truncated);
    assert_eq!(
        card.sidecar_paths,
        [
            tree.text("ds/task-rest_bold.json"),
            tree.text("ds/sub-01/sub-01_task-rest_bold.json"),
            tree.text("ds/sub-01/func/sub-01_task-rest_bold.json"),
        ]
    );
    let entry = |key: &str| card.entries.iter().find(|e| e.key == key).unwrap();
    let keys: Vec<&str> = card.entries.iter().map(|e| e.key.as_str()).collect();
    assert_eq!(
        keys,
        [
            "EchoTime",
            "Institution",
            "RepetitionTime",
            "SliceTiming",
            "TaskName"
        ]
    );
    // The file's own value wins, and the card says what it replaced.
    let echo = entry("EchoTime");
    assert_eq!(echo.value, "0.03");
    assert_eq!(echo.source_level, SidecarLevel::File);
    assert_eq!(
        echo.source_path,
        tree.text("ds/sub-01/func/sub-01_task-rest_bold.json")
    );
    assert_eq!(
        echo.overridden_paths,
        [
            tree.text("ds/task-rest_bold.json"),
            tree.text("ds/sub-01/sub-01_task-rest_bold.json"),
        ]
    );
    let institution = entry("Institution");
    assert_eq!(institution.value, r#""B""#);
    assert_eq!(institution.source_level, SidecarLevel::Subject);
    let tr = entry("RepetitionTime");
    assert_eq!(tr.value, "2.0");
    assert_eq!(tr.source_level, SidecarLevel::Dataset);
    assert_eq!(tr.source_path, tree.text("ds/task-rest_bold.json"));
    assert!(tr.overridden_paths.is_empty());
    assert_eq!(entry("SliceTiming").value, "[0.0,0.5,1.0]");
    assert_eq!(
        serde_json::to_value(echo).unwrap()["sourceLevel"],
        serde_json::json!("file")
    );

    let header = card.header.unwrap();
    assert_eq!(header.dim, [8, 8, 4]);
    assert_eq!(header.voxel_sizes, [2.0, 2.0, 2.0]);
    assert_eq!(header.datatype.as_deref(), Some("int16"));
    assert_eq!(card.header_issue, None);
}

#[tokio::test]
async fn sidecar_card_of_a_file_that_is_not_entity_named() {
    let tree = Tree::new();
    tree.file("rsa/dataset_description.json", "{}")
        .file("rsa/item.json", r#"{"Shared": 1}"#)
        .file("rsa/sub-01/maps/item.json", r#"{"Shared": 2}"#)
        .file("rsa/sub-01/maps/same_item.json", r#"{"Metric": "pearson"}"#)
        .file("rsa/sub-01/maps/same_item.nii.gz", b"not a nifti file")
        .file("rsa/sub-01/maps/diff_item.nii.gz", b"")
        .file("rsa/sub-01/maps/broken.json", r#"{"Kept": 1, "Lost": "#)
        .file("rsa/sub-01/maps/broken.nii", nifti_header())
        .file("rsa/sub-01/maps/surface.gii", b"");
    let card_of = |rel: &'static str| {
        let path = tree.path(rel);
        async move { build_sidecar_card(&CardFs::Local, &path, None).await }
    };

    let same = card_of("rsa/sub-01/maps/same_item.nii.gz").await.unwrap();
    assert!(!same.entity_named);
    assert_eq!(same.dataset_root, Some(tree.text("rsa")));
    assert_eq!(same.entries.len(), 1);
    assert_eq!(same.entries[0].key, "Metric");
    assert_eq!(same.entries[0].value, r#""pearson""#);
    assert_eq!(same.entries[0].source_level, SidecarLevel::File);
    // The bytes are not a header: the card says so and keeps the metadata.
    assert!(same.header.is_none());
    assert!(same.header_issue.unwrap().contains("could not be read"));

    // No sidecar of its own: nothing is inherited by a bare suffix.
    let diff = card_of("rsa/sub-01/maps/diff_item.nii.gz").await.unwrap();
    assert!(diff.entries.is_empty() && diff.sidecar_paths.is_empty());

    // A sidecar cut short keeps the fields before the error.
    let broken = card_of("rsa/sub-01/maps/broken.nii").await.unwrap();
    assert_eq!(broken.entries.len(), 1);
    assert_eq!(broken.entries[0].key, "Kept");
    assert!(broken.issues[0].contains("broken.json: invalid JSON"));
    assert_eq!(broken.header.unwrap().dim, [8, 8, 4]);

    let surface = card_of("rsa/sub-01/maps/surface.gii").await.unwrap();
    assert!(surface.header.is_none());
    assert!(surface.header_issue.unwrap().contains("NIfTI files"));

    let missing = card_of("rsa/sub-01/maps/absent.nii.gz").await.unwrap_err();
    assert!(missing.contains("not in its folder"), "{missing}");
}

#[tokio::test]
async fn sidecar_search_stops_at_the_browse_root_when_there_is_no_dataset_root() {
    let tree = Tree::new();
    let image = "top/browsed/sub-01/sub-01_bold.nii";
    tree.file("top/bold.json", r#"{"Above": true}"#)
        .file("top/browsed/bold.json", r#"{"AtRoot": true}"#)
        .file(image, nifti_header());
    let bound = tree.path("top/browsed");
    let card = build_sidecar_card(&CardFs::Local, &tree.path(image), Some(&bound))
        .await
        .unwrap();
    assert_eq!(card.dataset_root, None);
    let keys: Vec<&str> = card.entries.iter().map(|e| e.key.as_str()).collect();
    assert_eq!(keys, ["AtRoot"]);
    assert_eq!(card.entries[0].source_level, SidecarLevel::Directory);

    // With no browse root either, only the file's own folder is trusted.
    let card = build_sidecar_card(&CardFs::Local, &tree.path(image), None)
        .await
        .unwrap();
    assert!(card.entries.is_empty());
}

// ---- paths ----

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn paths_outside_the_browse_root_are_refused() {
    let tree = Tree::new();
    tree.file("inside/dataset_description.json", r#"{"Name": "In"}"#)
        .file("outside/dataset_description.json", r#"{"Name": "Out"}"#)
        .file("outside/README", "secret")
        .file("inside/sub-01/x.nii", nifti_header());
    let state = BridgeState::default().unwrap();
    let root = Some(tree.text("inside"));
    let code = |error: BridgeError| match error {
        BridgeError::Input { code, .. } => code,
        other => panic!("expected an input error, got {other:?}"),
    };

    let traversal = format!("{}/../outside", tree.text("inside"));
    for path in [traversal.as_str(), "relative/folder", "", "../up"] {
        let error = card_impl(&state, path.into(), root.clone(), false)
            .await
            .unwrap_err();
        assert_eq!(code(error), 8260, "{path}");
        // A marker batch answers every path: a refused one has no marker.
        let refused = markers_impl(&state, vec![path.into()], root.clone())
            .await
            .unwrap();
        assert_eq!(refused, [no_marker(path)], "{path}");
        let error = sidecar_impl(&state, path.into(), root.clone())
            .await
            .unwrap_err();
        assert_eq!(code(error), 8260, "{path}");
    }
    // Absolute and clean, but not under the browse root.
    for path in [tree.text("outside"), tree.text("")] {
        let error = card_impl(&state, path.clone(), root.clone(), false)
            .await
            .unwrap_err();
        assert_eq!(code(error), 8261);
        let refused = markers_impl(&state, vec![path.clone()], root.clone())
            .await
            .unwrap();
        assert_eq!(refused, [no_marker(&path)]);
        let error = sidecar_impl(&state, path, root.clone()).await.unwrap_err();
        assert_eq!(code(error), 8261);
    }
    let error = card_impl(
        &state,
        tree.text("inside"),
        Some("not/absolute".into()),
        false,
    )
    .await
    .unwrap_err();
    assert_eq!(code(error), 8260);

    // The same calls inside the root work, through the command path.
    let card = card_impl(&state, tree.text("inside"), root.clone(), false)
        .await
        .unwrap();
    assert_eq!(card.description.unwrap().name.as_deref(), Some("In"));
    assert_eq!(card.contents.subject_count, 1);
    let sidecar = sidecar_impl(&state, tree.text("inside/sub-01/x.nii"), root.clone())
        .await
        .unwrap();
    assert_eq!(sidecar.header.unwrap().dim, [8, 8, 4]);

    // A folder that does not exist is a typed error, not a panic.
    let error = card_impl(&state, tree.text("inside/nowhere"), root.clone(), false)
        .await
        .unwrap_err();
    assert!(matches!(error, BridgeError::Io { code: 8263, .. }));

    // A folder under the remote cache with no connected mount says so.
    let unmounted = crate::remote_cache_root()
        .unwrap()
        .join("not-mounted/study");
    let error = card_impl(&state, shown(&unmounted), None, false)
        .await
        .unwrap_err();
    assert_eq!(code(error), 8232);
    let error = markers_impl(&state, vec![shown(&unmounted)], None)
        .await
        .unwrap_err();
    assert!(error.to_string().contains("Remote mount is not active"));
}

#[cfg(unix)]
#[tokio::test]
async fn links_are_not_followed_out_of_the_browsed_folder() {
    use std::os::unix::fs::symlink;
    let tree = Tree::new();
    tree.file(
        "outside/dataset_description.json",
        r#"{"Name": "Elsewhere"}"#,
    )
    .file("outside/README", "secret")
    .images(&["outside/sub-07/leak.nii.gz"])
    .file("outside/sub-07/sub-07_bold.json", r#"{"Leaked": true}"#)
    .file("outside/sub-07/sub-07_bold.nii", nifti_header())
    .file("inside/annex/readme-object", "annexed text")
    .dir("inside/ds/sub-01");
    symlink(
        tree.path("outside/dataset_description.json"),
        tree.path("inside/ds/dataset_description.json"),
    )
    .unwrap();
    symlink(tree.path("outside/README"), tree.path("inside/ds/README")).unwrap();
    symlink(tree.path("outside/sub-07"), tree.path("inside/ds/sub-07")).unwrap();
    symlink(
        tree.path("outside/sub-07/sub-07_bold.json"),
        tree.path("inside/ds/sub-01/sub-01_bold.json"),
    )
    .unwrap();
    symlink(
        tree.path("outside/sub-07/sub-07_bold.nii"),
        tree.path("inside/ds/sub-01/sub-01_bold.nii"),
    )
    .unwrap();

    let root = tree.path("inside");
    let folder = tree.path("inside/ds");
    let entries = CardFs::Local.list(&folder).await.unwrap();
    let card = build_card(&CardFs::Local, &folder, &root, entries, WalkCaps::default())
        .await
        .card;
    // The description is there, but its target is outside: not read.
    assert!(card.has_description);
    assert!(card.description.is_none());
    assert_eq!(card.description_raw, None);
    assert!(card
        .description_issue
        .unwrap()
        .contains("leaves the browsed folder"));
    assert!(card.readme.is_none());
    assert!(card.source_paths.is_empty());
    // A linked folder is not a subject folder and is not walked.
    assert_eq!(card.contents.subject_count, 1);
    // The linked image is counted by its name; nothing of it is read.
    assert_eq!(card.contents.image_count, 1);

    let marker = probe_marker(&CardFs::Local, &folder, &root, "asked", None).await;
    assert!(marker.marker.has_description);
    assert_eq!(marker.marker.summary, None);
    assert!(marker
        .marker
        .issue
        .unwrap()
        .contains("leaves the browsed folder"));

    let sidecar = build_sidecar_card(
        &CardFs::Local,
        &tree.path("inside/ds/sub-01/sub-01_bold.nii"),
        Some(&root),
    )
    .await
    .unwrap();
    assert!(sidecar.entries.is_empty());
    assert!(sidecar.issues[0].contains("leaves the browsed folder"));
    assert!(sidecar.header.is_none());
    assert!(sidecar
        .header_issue
        .unwrap()
        .contains("leaves the browsed folder"));

    // A link that stays inside (an annexed file) is read.
    fs::remove_file(tree.path("inside/ds/README")).unwrap();
    symlink(
        tree.path("inside/annex/readme-object"),
        tree.path("inside/ds/README"),
    )
    .unwrap();
    let entries = CardFs::Local.list(&folder).await.unwrap();
    let card = build_card(&CardFs::Local, &folder, &root, entries, WalkCaps::default())
        .await
        .card;
    assert_eq!(card.readme.unwrap().text, "annexed text");
}

// ---- cancellation and the card cache ----

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_cancelled_ticket_stops_a_card_and_an_unchanged_folder_is_reused() {
    let tree = Tree::new();
    tree.file("ds/dataset_description.json", r#"{"Name": "Cached"}"#)
        .images(&["ds/sub-01/func/a.nii.gz"]);
    let state = BridgeState::default().unwrap();
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;
    let ticket = SampleTicket {
        id: uuid::Uuid::new_v4().to_string(),
        expires_at_ms: now + 60_000,
    };
    // Cancellation may arrive before the command it cancels.
    state.population_sampling.cancel(&ticket).unwrap();
    let cancelled = cancellable(
        &state,
        Some(ticket),
        card_impl(&state, tree.text("ds"), None, false),
    )
    .await
    .unwrap_err();
    assert!(matches!(cancelled, BridgeError::Input { code: 2026, .. }));

    let first = card_impl(&state, tree.text("ds"), None, false)
        .await
        .unwrap();
    assert_eq!(first.contents.image_count, 1);
    // A change below the folder leaves its own listing as it was: the cached
    // card is returned until a refresh is asked for.
    tree.images(&["ds/sub-01/func/b.nii.gz"]);
    let reused = card_impl(&state, tree.text("ds"), None, false)
        .await
        .unwrap();
    assert_eq!(reused.contents.image_count, 1);
    let refreshed = card_impl(&state, tree.text("ds"), None, true)
        .await
        .unwrap();
    assert_eq!(refreshed.contents.image_count, 2);
    // A change in the folder itself is seen without one.
    tree.dir("ds/sub-02");
    let changed = card_impl(&state, tree.text("ds"), None, false)
        .await
        .unwrap();
    assert_eq!(changed.contents.subject_count, 2);
}

// ---- review fixes, 2026-11-10 ----

/// The key of a folder asked for with the tree as its browse root.
fn local_key(tree: &Tree, rel: &str) -> CacheKey {
    local_key_in(tree, Some(""), rel)
}

/// The key of a folder asked for with `root` as its browse root, or none.
fn local_key_in(tree: &Tree, root: Option<&str>, rel: &str) -> CacheKey {
    let clean = |rel: &str| tree.path(rel).components().collect::<PathBuf>();
    ("local".to_string(), root.map(clean), tree.path(rel))
}

/// A marker batch has a time budget. A folder it does not reach gets an
/// answer that says nothing, or the last one known, and nothing is kept.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_marker_batch_out_of_time_answers_without_keeping_anything() {
    let tree = Tree::new();
    tree.file("ds/dataset_description.json", r#"{"Name": "Slow"}"#)
        .file("known/dataset_description.json", r#"{"Name": "Now"}"#);
    let state = BridgeState::default().unwrap();
    let root = Some(tree.text(""));
    let asked = vec![tree.text("ds"), tree.text("known")];

    // The last answer for `known` is past its freshness window.
    let stale = Instant::now()
        .checked_sub(MARKER_FRESH + Duration::from_secs(1))
        .unwrap();
    let before = DatasetMarker {
        has_description: true,
        ..no_marker("earlier")
    };
    state.dataset_cards.keep_marker(
        local_key(&tree, "known"),
        CachedMarker {
            marker: before.clone(),
            stamp: 0,
            computed: stale,
            checked: stale,
        },
    );

    let late = markers_within(&state, asked.clone(), root.clone(), Duration::ZERO)
        .await
        .unwrap();
    assert_eq!(late[0], no_marker(&asked[0]));
    assert_eq!(
        late[1],
        DatasetMarker {
            path: asked[1].clone(),
            ..before
        }
    );
    assert!(state
        .dataset_cards
        .marker(&local_key(&tree, "ds"))
        .is_none());
    let kept = state
        .dataset_cards
        .marker(&local_key(&tree, "known"))
        .unwrap();
    assert_eq!(kept.checked, stale, "a late answer refreshes nothing");

    // With time to read, the same folders are answered from disk.
    let read = markers_impl(&state, asked, root).await.unwrap();
    let name = |marker: &DatasetMarker| marker.summary.as_ref().unwrap().name.clone();
    assert_eq!(name(&read[0]).as_deref(), Some("Slow"));
    assert_eq!(name(&read[1]).as_deref(), Some("Now"));
}

/// On a remote mount a marker lists a folder's children only when the folder
/// announces derivatives; a local folder of analyses is still counted.
#[tokio::test]
async fn a_remote_marker_counts_analyses_only_where_derivatives_are_announced() {
    let tree = Tree::new();
    tree.dir("pile/one/sub-01")
        .dir("pile/two/sub-01")
        .dir("study/derivatives/glm/sub-01")
        .dir("study/sub-01");
    let listed = |rel: &str| list_local(&tree.path(rel), usize::MAX).unwrap();
    let asks =
        |remote: bool, rel: &str| marker_counts_analyses(remote, &tree.path(rel), &listed(rel));
    assert!(!asks(true, "pile"));
    assert!(!asks(true, "study/sub-01"));
    assert!(asks(true, "study"));
    assert!(asks(true, "study/derivatives"));
    assert!(asks(false, "pile"));

    let pile = probe_marker(&CardFs::Local, &tree.path("pile"), &tree.0, "asked", None).await;
    assert_eq!(pile.marker.analysis_count, Some(2));
}

/// An answer that fell short because something could not be read is returned
/// but not kept; one that fell short at a fixed bound is.
#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_answer_that_could_not_be_read_in_full_is_not_kept() {
    use std::os::unix::fs::PermissionsExt;
    let tree = Tree::new();
    let base = tree.0.clone();
    let mode = |rel: &str, mode: u32| {
        fs::set_permissions(base.join(rel), fs::Permissions::from_mode(mode)).unwrap()
    };
    tree.file("ds/dataset_description.json", r#"{"Name": "Guarded"}"#)
        .file("ds/README", "read me")
        .images(&["ds/sub-01/func/a.nii.gz", "ds/sub-02/func/b.nii.gz"])
        .dir("ds/derivatives/glm/sub-01");
    let state = BridgeState::default().unwrap();
    let root = Some(tree.text(""));
    let card = || card_impl(&state, tree.text("ds"), root.clone(), false);

    // A folder below the root is closed: the root listing does not change.
    mode("ds/sub-02/func", 0o000);
    mode("ds/README", 0o000);
    mode("ds/derivatives", 0o000);
    let partial = card().await.unwrap();
    mode("ds/sub-02/func", 0o755);
    mode("ds/README", 0o644);
    mode("ds/derivatives", 0o755);
    assert_eq!(partial.contents.image_count, 1);
    assert!(partial.contents.truncated);
    let reason = partial.contents.truncated_reason.as_deref().unwrap();
    assert!(reason.contains("1 folder(s) could not be read"), "{reason}");
    // Neither the README nor the derivatives folder is lost in silence.
    assert!(reason.contains("derivatives could not be read"), "{reason}");
    assert!(partial.analyses.is_empty() && partial.analyses_truncated);
    assert!(partial.readme.is_none());
    let issue = partial.description_issue.as_deref().unwrap();
    assert!(issue.contains("README could not be read"), "{issue}");
    assert!(state.dataset_cards.card(&local_key(&tree, "ds")).is_none());

    // Once it can be read, the card is whole without a refresh, and is kept.
    let whole = card().await.unwrap();
    assert_eq!(whole.contents.image_count, 2);
    assert!(!whole.contents.truncated);
    assert_eq!(whole.readme.as_ref().unwrap().text, "read me");
    assert_eq!(whole.analyses.len(), 1);
    assert_eq!(whole.description_issue, None);
    assert!(state.dataset_cards.card(&local_key(&tree, "ds")).is_some());

    // Markers: an unreadable description or derivatives folder is an issue
    // for this answer only.
    mode("ds/dataset_description.json", 0o000);
    mode("ds/derivatives", 0o000);
    let markers = markers_impl(&state, vec![tree.text("ds")], root.clone())
        .await
        .unwrap();
    mode("ds/dataset_description.json", 0o644);
    mode("ds/derivatives", 0o755);
    let issue = markers[0].issue.as_deref().unwrap();
    assert!(issue.contains("dataset_description.json could not be read"));
    assert!(issue.contains("derivatives could not be read"), "{issue}");
    assert!(state
        .dataset_cards
        .marker(&local_key(&tree, "ds"))
        .is_none());
    let markers = markers_impl(&state, vec![tree.text("ds")], root.clone())
        .await
        .unwrap();
    assert_eq!(markers[0].issue, None);
    assert_eq!(markers[0].analysis_count, Some(1));
    assert_eq!(
        markers[0].summary.as_ref().unwrap().name.as_deref(),
        Some("Guarded")
    );
    // A description that is wrong on disk is a fact, and is kept.
    tree.file("bad/dataset_description.json", r#"{"Name": "Bad", "#);
    let bad = markers_impl(&state, vec![tree.text("bad")], root)
        .await
        .unwrap();
    assert!(bad[0].issue.as_deref().unwrap().contains("invalid JSON"));
    assert!(state
        .dataset_cards
        .marker(&local_key(&tree, "bad"))
        .is_some());

    // A walk that stops at a fixed bound is the same next time; one that
    // runs out of time is not.
    let folder = tree.path("ds");
    let build = |caps: WalkCaps| {
        let folder = folder.clone();
        let contain = tree.0.clone();
        async move {
            let entries = CardFs::Local.list(&folder).await.unwrap();
            build_card(&CardFs::Local, &folder, &contain, entries, caps).await
        }
    };
    let caps = WalkCaps::default();
    let shallow = build(WalkCaps {
        max_depth: 1,
        ..caps
    })
    .await;
    assert!(shallow.card.contents.truncated && !shallow.transient);
    let no_time = build(WalkCaps {
        budget: Duration::ZERO,
        ..caps
    })
    .await;
    assert!(no_time.card.contents.truncated && no_time.transient);
    assert!(!build(caps).await.transient);
}

/// The time budget ends a batch of listings that is still running, and a
/// local listing stops reading at the entry allowance.
#[tokio::test]
async fn a_walk_stops_at_its_budget_and_a_listing_at_its_allowance() {
    let tree = Tree::new();
    tree.images(&["slow/sub-01/func/a.nii.gz", "slow/sub-02/func/b.nii.gz"]);
    let folder = tree.path("slow");
    let entries = CardFs::Local.list(&folder).await.unwrap();
    let caps = WalkCaps {
        budget: Duration::from_millis(50),
        ..WalkCaps::default()
    };
    let started = Instant::now();
    let built = build_card(
        &CardFs::Slow(Duration::from_secs(5)),
        &folder,
        &tree.0,
        entries,
        caps,
    )
    .await;
    assert!(
        started.elapsed() < Duration::from_secs(4),
        "the batch was not waited for"
    );
    let contents = &built.card.contents;
    assert!(contents.truncated && built.transient);
    let reason = contents.truncated_reason.as_deref().unwrap();
    assert!(reason.contains("took longer"), "{reason}");
    // The subjects were in the root listing; nothing below them was read.
    assert_eq!((contents.subject_count, contents.image_count), (2, 0));

    let names: Vec<String> = (0..30).map(|i| format!("flat/a/f{i}.nii.gz")).collect();
    tree.images(&names.iter().map(String::as_str).collect::<Vec<_>>());
    let names: Vec<String> = (0..30).map(|i| format!("flat/b/f{i}.nii.gz")).collect();
    tree.images(&names.iter().map(String::as_str).collect::<Vec<_>>());
    assert_eq!(list_local(&tree.path("flat/a"), 10).unwrap().len(), 10);
    assert_eq!(list_local(&tree.path("flat/a"), 0).unwrap().len(), 0);
    assert_eq!(list_local(&tree.path("flat/a"), 100).unwrap().len(), 30);
    let both = [tree.path("flat/a"), tree.path("flat/b")];
    let listed = CardFs::Local.list_many_within(&both, 42).await;
    let lengths: Vec<usize> = listed.iter().map(|l| l.as_ref().unwrap().len()).collect();
    assert_eq!(lengths, [30, 12]);
    // The walk still reports the bound it met.
    let capped = card_with(
        &tree,
        "flat",
        WalkCaps {
            max_entries: 40,
            ..WalkCaps::default()
        },
    )
    .await
    .contents;
    assert!(capped
        .truncated_reason
        .as_deref()
        .unwrap()
        .contains("more than 40 entries"));
}

/// Linked folders are not followed, and the card says so: its counts are
/// floors, and a dataset whose subjects are links is not taken for a folder
/// of analyses.
#[cfg(unix)]
#[tokio::test]
async fn linked_folders_make_counts_a_minimum() {
    use std::os::unix::fs::symlink;
    let tree = Tree::new();
    tree.images(&[
        "store/sub-01/anat/sub-01_T1w.nii.gz",
        "store/sub-02/anat/sub-02_T1w.nii.gz",
        "store/objects/blob",
    ])
    .file("ds/dataset_description.json", r#"{"Name": "Linked"}"#)
    // A described child: an analysis, were this a folder of analyses.
    .file("ds/qc/dataset_description.json", r#"{"Name": "QC"}"#)
    .dir("coll/first")
    .dir("annexed/sub-01/anat");
    for subject in ["sub-01", "sub-02"] {
        symlink(
            tree.path(&format!("store/{subject}")),
            tree.path(&format!("ds/{subject}")),
        )
        .unwrap();
    }
    symlink(tree.path("store/sub-01"), tree.path("coll/first/sub-01")).unwrap();
    // Annexed files are links to files: counted by name, not as folders.
    for name in ["sub-01_T1w.nii.gz", "sub-01_T1w.json", "sub-01_scans.tsv"] {
        symlink(
            tree.path("store/objects/blob"),
            tree.path(&format!("annexed/sub-01/anat/{name}")),
        )
        .unwrap();
    }

    let card = card_of(&tree, "ds").await;
    assert_eq!(card.contents.subject_count, 0);
    assert!(card.contents.truncated);
    let reason = card.contents.truncated_reason.as_deref().unwrap();
    assert!(
        reason.contains("2 linked folder(s) were not followed"),
        "{reason}"
    );
    assert!(card.analyses.is_empty());
    assert_eq!(card.analyses_path, None);
    let marker = probe_marker(&CardFs::Local, &tree.path("ds"), &tree.0, "asked", None).await;
    assert_eq!(marker.marker.analysis_count, None);

    // An analysis whose subjects are links is still an analysis.
    let coll = card_of(&tree, "coll").await;
    assert_eq!(coll.analyses.len(), 1);
    assert_eq!(coll.analyses[0].folder_name, "first");
    // Its subjects were not counted, and the row says the count is a floor.
    assert_eq!(coll.analyses[0].subject_count, 0);
    assert!(coll.analyses[0].subject_count_truncated);

    let annexed = card_of(&tree, "annexed").await;
    assert_eq!(annexed.contents.image_count, 1);
    assert!(!annexed.contents.truncated);

    // A remote listing does not resolve links: there the name decides.
    let link = |name: &str| Entry {
        name: name.into(),
        kind: Kind::Link,
        size: 0,
        modified: None,
    };
    assert!(link("sub-01").is_skipped_folder_link());
    assert!(is_subject_link(&link("sub-01")));
    assert!(link("fmriprep").is_skipped_folder_link());
    assert!(!is_subject_link(&link("fmriprep")));
    for file in ["sub-01_bold.nii.gz", "sub-01_bold.json", "README", "x.tsv"] {
        assert!(!link(file).is_skipped_folder_link(), "{file}");
    }
}

/// Child folders past the analyses bound are not counted as the collection's
/// own contents.
#[tokio::test]
async fn analyses_beyond_the_card_bound_are_not_counted_as_contents() {
    let tree = Tree::new();
    let extra = 2;
    for i in 0..CARD_ANALYSIS_CHILDREN + extra {
        tree.images(&[&format!("many/a{i:03}/sub-01/map.nii.gz")]);
    }
    tree.images(&["many/loose.nii.gz"]);
    let card = card_of(&tree, "many").await;
    assert_eq!(card.analyses.len(), CARD_ANALYSIS_CHILDREN);
    assert!(card.analyses_truncated);
    assert_eq!(card.contents.subject_count, 0);
    assert_eq!(card.contents.image_count, 1);
    assert!(card.contents.truncated);
    let reason = card.contents.truncated_reason.as_deref().unwrap();
    assert!(
        reason.contains("2 folder(s) beyond the first 64 were not examined"),
        "{reason}"
    );
}

/// A folder reached through a link that leaves the browse root is not listed.
#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_linked_path_component_that_leaves_the_browse_root_is_refused() {
    use std::os::unix::fs::symlink;
    let tree = Tree::new();
    tree.file("outside/dataset_description.json", r#"{"Name": "Out"}"#)
        .file("outside/sub-07/sub-07_bold.nii", nifti_header())
        .file("outside/sub-07/sub-07_bold.json", r#"{"Leaked": true}"#)
        .file("inside/ds/dataset_description.json", r#"{"Name": "In"}"#)
        .file("inside/ds/sub-01/sub-01_bold.nii", nifti_header());
    symlink(tree.path("outside"), tree.path("inside/away")).unwrap();
    symlink(tree.path("inside/ds"), tree.path("inside/alias")).unwrap();
    let state = BridgeState::default().unwrap();
    let root = Some(tree.text("inside"));
    let refused = |error: BridgeError| {
        assert!(
            matches!(error, BridgeError::Input { code: 8261, .. }),
            "{error:?}"
        );
        assert!(error.to_string().contains("leaves the browsed folder"));
    };

    for folder in ["inside/away", "inside/away/sub-07"] {
        refused(
            card_impl(&state, tree.text(folder), root.clone(), false)
                .await
                .unwrap_err(),
        );
    }
    refused(
        sidecar_impl(
            &state,
            tree.text("inside/away/sub-07/sub-07_bold.nii"),
            root.clone(),
        )
        .await
        .unwrap_err(),
    );
    let asked = vec![tree.text("inside/away"), tree.text("inside/ds")];
    let markers = markers_impl(&state, asked.clone(), root.clone())
        .await
        .unwrap();
    assert_eq!(markers[0], no_marker(&asked[0]));
    assert!(markers[1].has_description);
    assert!(state
        .dataset_cards
        .marker(&local_key_in(&tree, Some("inside"), "inside/away"))
        .is_none());

    // A link that stays inside the root is browsed like any folder.
    let card = card_impl(&state, tree.text("inside/alias"), root.clone(), false)
        .await
        .unwrap();
    assert_eq!(card.description.unwrap().name.as_deref(), Some("In"));
    let sidecar = sidecar_impl(
        &state,
        tree.text("inside/alias/sub-01/sub-01_bold.nii"),
        root,
    )
    .await
    .unwrap();
    assert_eq!(sidecar.header.unwrap().dim, [8, 8, 4]);
    // With no browse root named there is nothing to leave.
    let unbounded = card_impl(&state, tree.text("inside/away"), None, false)
        .await
        .unwrap();
    assert_eq!(unbounded.description.unwrap().name.as_deref(), Some("Out"));
}

/// What a card returns is bounded: long text fields and lists are cut, and a
/// sidecar card lists a bounded number of entries and says how many it left.
#[tokio::test]
async fn long_fields_and_many_sidecar_entries_are_cut() {
    let long = "x".repeat(MAX_VALUE_CHARS + 500);
    let authors: Vec<String> = (0..MAX_LIST_ITEMS + 50).map(|i| format!("A{i}")).collect();
    let json = serde_json::json!({
        "Name": long,
        "License": "CC0",
        "Authors": authors,
        "GeneratedBy": [{"Name": "pipe", "Description": long}],
    });
    let parsed = parse_description(json.to_string().as_bytes(), false);
    let description = parsed.description.unwrap();
    assert_eq!(description.name.unwrap().chars().count(), MAX_VALUE_CHARS);
    assert_eq!(description.license.as_deref(), Some("CC0"));
    assert_eq!(description.authors.len(), MAX_LIST_ITEMS);
    let pipeline = &description.generated_by[0];
    assert_eq!(
        pipeline.description.as_ref().unwrap().chars().count(),
        MAX_VALUE_CHARS
    );
    // Fields are named in file order (this JSON is written with sorted keys).
    assert_eq!(
        parsed.issue.as_deref(),
        Some("Authors, GeneratedBy, Name is too long to show in full and was cut")
    );

    let tree = Tree::new();
    let extra = 100;
    let fields: serde_json::Map<String, Value> = (0..MAX_SIDECAR_ENTRIES + extra)
        .map(|i| (format!("K{i:04}"), Value::from(i)))
        .collect();
    tree.file("ds/sub-01_bold.nii", nifti_header())
        .file("ds/sub-01_bold.json", Value::Object(fields).to_string());
    let card = build_sidecar_card(&CardFs::Local, &tree.path("ds/sub-01_bold.nii"), None)
        .await
        .unwrap();
    assert_eq!(card.entries.len(), MAX_SIDECAR_ENTRIES);
    assert_eq!(card.entries[0].key, "K0000");
    assert_eq!(
        card.issues,
        ["100 further field(s) are not shown: the card lists at most 500"]
    );
}

/// A path is taken as written: a folder whose name ends or begins with a
/// space is that folder, not its trimmed neighbour.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_name_with_outer_spaces_is_not_trimmed() {
    let tree = Tree::new();
    tree.file("ds /dataset_description.json", r#"{"Name": "Spaced"}"#)
        .file("ds/dataset_description.json", r#"{"Name": "Plain"}"#);
    let state = BridgeState::default().unwrap();
    let name = |card: DatasetCard| card.description.unwrap().name.unwrap();
    let spaced = card_impl(&state, tree.text("ds "), Some(tree.text("")), false)
        .await
        .unwrap();
    assert_eq!(spaced.folder_name, "ds ");
    assert_eq!(name(spaced), "Spaced");
    let plain = card_impl(&state, tree.text("ds"), Some(tree.text("")), false)
        .await
        .unwrap();
    assert_eq!(name(plain), "Plain");
    // Text that only becomes a path once trimmed is not one.
    for path in [format!(" {}", tree.text("ds")), " ".to_string()] {
        let error = card_impl(&state, path, None, false).await.unwrap_err();
        assert!(matches!(error, BridgeError::Input { code: 8260, .. }));
    }
}

/// One path a marker batch cannot accept does not cost the others their
/// answers; more paths than a batch takes is still an error.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_marker_batch_answers_every_path_it_is_given() {
    let tree = Tree::new();
    tree.file("in/ds/dataset_description.json", r#"{"Name": "In"}"#)
        .file("out/dataset_description.json", r#"{"Name": "Out"}"#);
    let state = BridgeState::default().unwrap();
    let asked = vec![
        "relative/folder".to_string(),
        tree.text("in/ds"),
        tree.text("out"),
        format!("{}/../../out", tree.text("in/ds")),
        String::new(),
        tree.text("in/ds"),
    ];
    let markers = markers_impl(&state, asked.clone(), Some(tree.text("in")))
        .await
        .unwrap();
    assert_eq!(markers.len(), asked.len());
    for index in [0, 2, 3, 4] {
        assert_eq!(markers[index], no_marker(&asked[index]), "{index}");
    }
    for index in [1, 5] {
        assert_eq!(markers[index].path, asked[index]);
        let summary = markers[index].summary.as_ref().unwrap();
        assert_eq!(summary.name.as_deref(), Some("In"));
    }
    let too_many = vec![tree.text("in/ds"); MAX_MARKER_PATHS + 1];
    let error = markers_impl(&state, too_many, Some(tree.text("in")))
        .await
        .unwrap_err();
    assert!(matches!(error, BridgeError::Input { code: 8264, .. }));
}

// ---- phases, 2026-11-10 ----

fn phased_tree(tree: &Tree) {
    tree.file(
        "study/dataset_description.json",
        r#"{"Name": "Study", "Description": "What it is."}"#,
    )
    .file("study/README.md", "# Study")
    .images(&["study/sub-01/anat/sub-01_T1w.nii.gz"])
    .file(
        "study/derivatives/glm/dataset_description.json",
        r#"{"Name": "GLM", "DateCreated": " 2026-03-04 ", "GeneratedBy": [{"Name": "fitlins"}]}"#,
    )
    .images(&[
        "study/derivatives/glm/sub-01/maps/zstat.nii.gz",
        "study/derivatives/glm/sub-02/maps/zstat.nii.gz",
        "study/derivatives/glm/group/mean.nii.gz",
        // No description: found by its subjects, in the full phase only.
        "study/derivatives/rsa/sub-01/item.nii.gz",
        "study/derivatives/scratch/tmp.nii.gz",
    ])
    .file("study/derivatives/code/dataset_description.json", "{}");
}

async fn outline_of(tree: &Tree, rel: &str) -> BuiltCard {
    let folder = tree.path(rel);
    let entries = CardFs::Local.list(&folder).await.unwrap();
    build_outline(&CardFs::Local, &folder, &tree.0, &entries).await
}

async fn card_after(tree: &Tree, rel: &str, outline: Option<DatasetCard>) -> DatasetCard {
    let folder = tree.path(rel);
    let entries = CardFs::Local.list(&folder).await.unwrap();
    let caps = WalkCaps::default();
    build_card_after(&CardFs::Local, &folder, &tree.0, entries, caps, outline)
        .await
        .card
}

/// The descriptions phase says what the description files say and counts
/// nothing; the full phase that continues from it is the card a single
/// request builds.
#[tokio::test]
async fn the_descriptions_phase_reads_descriptions_and_counts_nothing() {
    let tree = Tree::new();
    phased_tree(&tree);
    let built = outline_of(&tree, "study").await;
    assert!(!built.transient);
    let outline = built.card;
    assert_eq!(outline.phase, DatasetCardPhase::Descriptions);
    let description = outline.description.as_ref().unwrap();
    assert_eq!(description.name.as_deref(), Some("Study"));
    assert_eq!(description.description.as_deref(), Some("What it is."));
    assert_eq!(outline.readme.as_ref().unwrap().text, "# Study");
    assert!(outline.description_raw.is_some());
    assert_eq!(outline.contents, DatasetContents::default());
    // Only the described child is known yet, and nothing about it is counted.
    assert_eq!(outline.analyses.len(), 1);
    let glm = &outline.analyses[0];
    assert_eq!(glm.folder_name, "glm");
    assert_eq!(glm.path, tree.text("study/derivatives/glm"));
    assert_eq!(glm.title.as_deref(), Some("GLM"));
    assert_eq!(glm.generated_by.as_ref().unwrap().name, "fitlins");
    assert_eq!(glm.date.as_deref(), Some("2026-03-04"));
    assert!(glm.has_description && !glm.has_group_level);
    assert_eq!(glm.subject_count, 0);
    assert_eq!(
        outline.analyses_path.as_deref(),
        Some(tree.text("study/derivatives").as_str())
    );
    assert!(!outline.analyses_truncated);
    assert_eq!(
        outline.source_paths,
        [
            tree.text("study/dataset_description.json"),
            tree.text("study/README.md"),
            tree.text("study/derivatives/glm/dataset_description.json"),
        ]
    );

    let whole = card_of(&tree, "study").await;
    assert_eq!(whole.phase, DatasetCardPhase::Full);
    let names: Vec<&str> = whole
        .analyses
        .iter()
        .map(|analysis| analysis.folder_name.as_str())
        .collect();
    assert_eq!(names, ["glm", "rsa"]);
    assert_eq!(whole.analyses[0].subject_count, 2);
    assert!(whole.analyses[0].has_group_level);
    assert!(!whole.analyses[0].subject_count_truncated);
    assert_eq!(whole.analyses[0].date.as_deref(), Some("2026-03-04"));
    assert_eq!(whole.analyses[1].date, None);
    assert_eq!(whole.contents.subject_count, 1);
    assert_eq!(card_after(&tree, "study", Some(outline)).await, whole);

    // A folder that is one dataset has an outline with no analyses, and a
    // folder of analyses with no description of its own still has its table.
    let glm = outline_of(&tree, "study/derivatives/glm").await.card;
    assert!(glm.analyses.is_empty() && glm.analyses_path.is_none());
    assert_eq!(glm.description.unwrap().name.as_deref(), Some("GLM"));
    let derivatives = outline_of(&tree, "study/derivatives").await.card;
    assert!(!derivatives.has_description);
    assert_eq!(derivatives.analyses.len(), 1);
    assert_eq!(
        derivatives.analyses_path.as_deref(),
        Some(tree.text("study/derivatives").as_str())
    );
}

/// What the descriptions phase read is not read again by the full phase.
#[tokio::test]
async fn the_full_phase_continues_from_the_descriptions_phase() {
    let tree = Tree::new();
    phased_tree(&tree);
    let outline = outline_of(&tree, "study").await.card;
    tree.file("study/dataset_description.json", r#"{"Name": "Renamed"}"#)
        .file("study/README.md", "changed")
        .file(
            "study/derivatives/glm/dataset_description.json",
            r#"{"Name": "GLM 2"}"#,
        )
        // Not described when the outline was read, so it is read now.
        .file(
            "study/derivatives/rsa/dataset_description.json",
            r#"{"Name": "RSA"}"#,
        );
    let continued = card_after(&tree, "study", Some(outline)).await;
    assert_eq!(
        continued.description.as_ref().unwrap().name.as_deref(),
        Some("Study")
    );
    assert_eq!(continued.readme.as_ref().unwrap().text, "# Study");
    assert_eq!(continued.analyses[0].title.as_deref(), Some("GLM"));
    assert_eq!(continued.analyses[0].subject_count, 2);
    assert_eq!(continued.analyses[1].title.as_deref(), Some("RSA"));
    assert_eq!(
        continued.source_paths,
        [
            tree.text("study/dataset_description.json"),
            tree.text("study/README.md"),
            tree.text("study/derivatives/glm/dataset_description.json"),
            tree.text("study/derivatives/rsa/dataset_description.json"),
        ]
    );
    let fresh = card_after(&tree, "study", None).await;
    assert_eq!(
        fresh.description.as_ref().unwrap().name.as_deref(),
        Some("Renamed")
    );
    assert_eq!(fresh.analyses[0].title.as_deref(), Some("GLM 2"));
}

/// More candidate folders than the card examines: the outline says so.
#[tokio::test]
async fn the_descriptions_phase_keeps_the_analyses_bound() {
    let tree = Tree::new();
    for i in 0..CARD_ANALYSIS_CHILDREN + 3 {
        tree.file(
            &format!("many/analysis{i}/dataset_description.json"),
            r#"{"Name": "A"}"#,
        );
    }
    let outline = outline_of(&tree, "many").await.card;
    assert_eq!(outline.analyses.len(), CARD_ANALYSIS_CHILDREN);
    assert!(outline.analyses_truncated);
    assert_eq!(outline.analyses[0].folder_name, "analysis0");
}

/// Each phase is kept and reused while the folder's listing is unchanged; a
/// whole card answers both phases; a refresh forgets both.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn both_phases_are_cached_and_a_whole_card_answers_either() {
    use DatasetCardPhase::{Descriptions, Full};
    let tree = Tree::new();
    phased_tree(&tree);
    let state = BridgeState::default().unwrap();
    let key = local_key(&tree, "study");
    let ask = |refresh: bool, phase: DatasetCardPhase| {
        card_phase_impl(
            &state,
            tree.text("study"),
            Some(tree.text("")),
            refresh,
            phase,
        )
    };
    let rename = |name: &str| {
        tree.file(
            "study/derivatives/glm/dataset_description.json",
            format!(r#"{{"Name": "{name}"}}"#),
        );
    };

    let outline = ask(false, Descriptions).await.unwrap();
    assert_eq!(outline.phase, Descriptions);
    assert!(state.dataset_cards.outline(&key).is_some());
    assert!(state.dataset_cards.card(&key).is_none());
    // Unchanged listing: the kept outline answers, nothing below is read.
    rename("Second");
    let again = ask(false, Descriptions).await.unwrap();
    assert_eq!(again, outline);

    // The full phase continues from it, and replaces it.
    let whole = ask(false, Full).await.unwrap();
    assert_eq!(whole.phase, Full);
    assert_eq!(whole.analyses[0].title.as_deref(), Some("GLM"));
    assert_eq!(whole.analyses[0].subject_count, 2);
    assert_eq!(whole.contents.image_count, 1);
    assert!(state.dataset_cards.card(&key).is_some());
    assert!(state.dataset_cards.outline(&key).is_none());
    // Reopened: the descriptions phase is answered with the whole card.
    assert_eq!(ask(false, Descriptions).await.unwrap(), whole);
    assert_eq!(ask(false, Full).await.unwrap(), whole);

    // A refresh with the first phase forgets both, so the full phase that
    // follows it (without a refresh of its own) cannot return the old card.
    let refreshed = ask(true, Descriptions).await.unwrap();
    assert_eq!(refreshed.phase, Descriptions);
    assert_eq!(refreshed.analyses[0].title.as_deref(), Some("Second"));
    assert!(state.dataset_cards.card(&key).is_none());
    let recounted = ask(false, Full).await.unwrap();
    assert_eq!(recounted.analyses[0].title.as_deref(), Some("Second"));

    // A change in the folder's own listing voids what is kept of it.
    rename("Third");
    tree.dir("study/sub-02");
    let changed = ask(false, Descriptions).await.unwrap();
    assert_eq!(changed.phase, Descriptions);
    assert_eq!(changed.analyses[0].title.as_deref(), Some("Third"));
    // The full phase asked for alone needs no outline.
    let direct = ask(true, Full).await.unwrap();
    assert_eq!(direct.contents.subject_count, 2);
    assert!(state.dataset_cards.outline(&key).is_none());
}

/// A cancelled ticket stops either phase, and a request that is dropped
/// mid-walk (its ticket was cancelled, or it was replaced) stops its worker.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cancelling_stops_either_phase_and_the_walk() {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    let tree = Tree::new();
    phased_tree(&tree);
    let state = BridgeState::default().unwrap();
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;
    for phase in [DatasetCardPhase::Descriptions, DatasetCardPhase::Full] {
        let ticket = SampleTicket {
            id: uuid::Uuid::new_v4().to_string(),
            expires_at_ms: now + 60_000,
        };
        state.population_sampling.cancel(&ticket).unwrap();
        let cancelled = cancellable(
            &state,
            Some(ticket),
            card_phase_impl(&state, tree.text("study"), None, false, phase),
        )
        .await
        .unwrap_err();
        assert!(matches!(cancelled, BridgeError::Input { code: 2026, .. }));
    }
    // Nothing of a cancelled request is kept.
    let key = local_key_in(&tree, None, "study");
    assert!(state.dataset_cards.outline(&key).is_none());
    assert!(state.dataset_cards.card(&key).is_none());

    // A ticket cancelled while the walk runs ends the command, and with it
    // the worker: neither phase reaches its end on a slow mount.
    for full in [false, true] {
        let finished = Arc::new(AtomicBool::new(false));
        let flag = finished.clone();
        let folder = tree.path("study");
        let contain = tree.0.clone();
        let entries = CardFs::Local.list(&folder).await.unwrap();
        let work = owned(move || {
            Box::pin(async move {
                let fs = CardFs::Slow(Duration::from_millis(150));
                if full {
                    build_card(&fs, &folder, &contain, entries, WalkCaps::default()).await;
                } else {
                    build_outline(&fs, &folder, &contain, &entries).await;
                }
                flag.store(true, Ordering::SeqCst);
            }) as Work<()>
        });
        let ticket = SampleTicket {
            id: uuid::Uuid::new_v4().to_string(),
            expires_at_ms: now + 60_000,
        };
        let cancel = async {
            tokio::time::sleep(Duration::from_millis(30)).await;
            state.population_sampling.cancel(&ticket).unwrap();
        };
        let (stopped, ()) = tokio::join!(cancellable(&state, Some(ticket.clone()), work), cancel);
        assert!(matches!(
            stopped.unwrap_err(),
            BridgeError::Input { code: 2026, .. }
        ));
        tokio::time::sleep(Duration::from_millis(500)).await;
        assert!(!finished.load(Ordering::SeqCst), "full phase: {full}");
    }
}

#[test]
fn a_date_is_taken_only_from_a_key_that_declares_one() {
    let date = |json: &str| {
        parse_description(json.as_bytes(), false)
            .description
            .as_ref()
            .and_then(declared_date)
    };
    assert_eq!(
        date(r#"{"Date": "2026-01-02"}"#).as_deref(),
        Some("2026-01-02")
    );
    assert_eq!(
        date(r#"{"datecreated": "2026-03-04T10:20:30Z"}"#).as_deref(),
        Some("2026-03-04T10:20:30Z")
    );
    // `Date` is preferred to the others, whatever the file order.
    assert_eq!(
        date(r#"{"Generated": "2025", "Date": "2026"}"#).as_deref(),
        Some("2026")
    );
    // Only text that starts with a four-digit year is a date: anything else
    // under such a key is not shown as one.
    assert_eq!(date(r#"{"datecreated": "March 2026"}"#), None);
    assert_eq!(date(r#"{"Generated": "b", "Date": "a"}"#), None);
    assert_eq!(date(r#"{"Date": "yes"}"#), None);
    assert_eq!(date(r#"{"Date": "202"}"#), None);
    assert_eq!(date(r#"{"Date": "03/04/2026"}"#), None);
    // A key whose value is no date does not hide one that is.
    assert_eq!(
        date(r#"{"Date": "pending", "DateCreated": "2026-03-04"}"#).as_deref(),
        Some("2026-03-04")
    );
    // Not text, empty, or only in a name: no date.
    assert_eq!(date(r#"{"Date": 20260102}"#), None);
    assert_eq!(date(r#"{"Date": "  "}"#), None);
    assert_eq!(date(r#"{"Name": "glm_2026-01-02"}"#), None);
    let long = format!(r#"{{"Date": "{}"}}"#, "9".repeat(100));
    assert_eq!(date(&long).unwrap().len(), 40);
}

// ---- review fixes, second round, 2026-11-10 ----

/// A child description that is there and cannot be read is not "no
/// description": the outline is short and is not kept. One that is not there
/// is a fact.
#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_unreadable_child_description_makes_the_outline_transient() {
    use std::os::unix::fs::PermissionsExt;
    let tree = Tree::new();
    phased_tree(&tree);
    let guarded = tree.path("study/derivatives/glm/dataset_description.json");
    let mode = |mode: u32| fs::set_permissions(&guarded, fs::Permissions::from_mode(mode)).unwrap();
    let state = BridgeState::default().unwrap();
    let key = local_key(&tree, "study");
    let ask = || {
        card_phase_impl(
            &state,
            tree.text("study"),
            Some(tree.text("")),
            false,
            DatasetCardPhase::Descriptions,
        )
    };

    mode(0o000);
    let built = outline_of(&tree, "study").await;
    let short = ask().await;
    mode(0o644);
    assert!(built.transient);
    assert!(built.card.analyses.is_empty());
    assert!(short.unwrap().analyses.is_empty());
    assert!(
        state.dataset_cards.outline(&key).is_none(),
        "a short outline is not kept"
    );

    // Readable again: read without a refresh, and kept. `rsa` and `scratch`
    // have no description, which is no reason to read the folder again.
    let whole = ask().await.unwrap();
    assert_eq!(whole.analyses.len(), 1);
    assert_eq!(whole.analyses[0].title.as_deref(), Some("GLM"));
    assert!(state.dataset_cards.outline(&key).is_some());
    assert!(!outline_of(&tree, "study").await.transient);
}

/// Each phase has a wall-clock budget for what it reads before the counting
/// walk. Out of time, it returns what it has, says so, and is not kept.
#[tokio::test]
async fn a_phase_out_of_time_returns_what_it_read_and_says_so() {
    let tree = Tree::new();
    phased_tree(&tree);
    let folder = tree.path("study");
    let entries = CardFs::Local.list(&folder).await.unwrap();
    let slow = CardFs::Slow(Duration::from_secs(5));
    let budget = Duration::from_millis(50);

    let started = Instant::now();
    let outline = build_outline_within(&slow, &folder, &tree.0, &entries, budget).await;
    assert!(
        started.elapsed() < Duration::from_secs(4),
        "the listing was not waited for"
    );
    assert!(outline.transient);
    // Its own files were read before `derivatives/` was listed.
    let card = outline.card;
    assert_eq!(card.description.unwrap().name.as_deref(), Some("Study"));
    assert_eq!(card.readme.unwrap().text, "# Study");
    assert!(card.analyses.is_empty());
    let issue = card.description_issue.as_deref().unwrap();
    assert!(issue.contains("took longer than 0 s"), "{issue}");

    let caps = WalkCaps {
        budget,
        read_budget: budget,
        ..WalkCaps::default()
    };
    let started = Instant::now();
    let built = build_card(&slow, &folder, &tree.0, entries.clone(), caps).await;
    assert!(started.elapsed() < Duration::from_secs(4));
    assert!(built.transient);
    assert_eq!(
        built.card.description.as_ref().unwrap().name.as_deref(),
        Some("Study")
    );
    assert!(built.card.contents.truncated);
    let reason = built.card.contents.truncated_reason.as_deref().unwrap();
    assert!(
        reason.contains("its analyses and descriptions took longer than 0 s to read"),
        "{reason}"
    );

    // A folder of analyses: the children not listed in time are not walked
    // as the folder's own contents.
    let pile = Tree::new();
    pile.images(&["pile/one/sub-01/a.nii.gz", "pile/two/sub-01/b.nii.gz"]);
    let folder = pile.path("pile");
    let entries = CardFs::Local.list(&folder).await.unwrap();
    let scanned = scan_analyses_until(
        &slow,
        &folder,
        &entries,
        CARD_ANALYSIS_CHILDREN,
        Some(tokio::time::Instant::now() + budget),
    )
    .await;
    assert!(scanned.timed_out);
    let scan = scanned.scan.unwrap();
    assert!(scan.children.is_empty() && scan.truncated);
    assert_eq!(scan.unexamined, ["one", "two"]);
    let built = build_card(&slow, &folder, &pile.0, entries.clone(), caps).await;
    assert!(built.transient && built.card.analyses_truncated);
    assert_eq!(built.card.contents.image_count, 0);
    let reason = built.card.contents.truncated_reason.as_deref().unwrap();
    assert!(reason.contains("2 folder(s) were not examined"), "{reason}");
    // With time, the same folder is read whole.
    let whole = build_card(
        &CardFs::Local,
        &folder,
        &pile.0,
        entries,
        WalkCaps::default(),
    )
    .await;
    assert!(!whole.transient && whole.card.analyses.len() == 2);
}

/// What a card may read depends on the folder its reads are contained in, so
/// a card read under one browse root does not answer for another.
#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_card_is_kept_per_browse_root() {
    use std::os::unix::fs::symlink;
    let tree = Tree::new();
    tree.file("ds/dataset_description.json", r#"{"Name": "Rooted"}"#)
        .file("shared/README", "kept beside the dataset");
    symlink(tree.path("shared/README"), tree.path("ds/README")).unwrap();
    let state = BridgeState::default().unwrap();
    let ask = |root: &str| card_impl(&state, tree.text("ds"), Some(tree.text(root)), false);

    // Browsing the tree, the link stays inside it and is read.
    let wide = ask("").await.unwrap();
    assert_eq!(
        wide.readme.as_ref().unwrap().text,
        "kept beside the dataset"
    );
    assert!(state.dataset_cards.card(&local_key(&tree, "ds")).is_some());
    // Browsing the dataset alone, the same link leaves the browsed folder.
    let narrow = ask("ds").await.unwrap();
    assert!(
        narrow.readme.is_none(),
        "answered with the other root's card"
    );
    let issue = narrow.description_issue.as_deref().unwrap();
    assert!(issue.contains("leaves the browsed folder"), "{issue}");
    assert_eq!(ask("").await.unwrap(), wide);

    // Markers are kept apart the same way.
    let marker = |root: &str| markers_impl(&state, vec![tree.text("ds")], Some(tree.text(root)));
    marker("").await.unwrap();
    assert!(state
        .dataset_cards
        .marker(&local_key(&tree, "ds"))
        .is_some());
    assert!(state
        .dataset_cards
        .marker(&local_key_in(&tree, Some("ds"), "ds"))
        .is_none());
}

/// A walk that began before a refresh keeps nothing when it ends after it:
/// what is kept is never older than the last refresh.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_walk_from_before_a_refresh_is_not_kept() {
    use DatasetCardPhase::{Descriptions, Full};
    let tree = Tree::new();
    phased_tree(&tree);
    let state = BridgeState::default().unwrap();
    let key = local_key(&tree, "study");
    let cache = &state.dataset_cards;

    // The cache itself: a card read at an older generation is refused.
    let card = card_of(&tree, "study").await;
    let before = cache.generation(&key);
    cache.forget_card(&key);
    assert!(!cache.keep_card(key.clone(), before, card.clone(), 7));
    assert!(cache.card(&key).is_none());
    let now = cache.generation(&key);
    assert_ne!(now, before);
    assert!(cache.keep_card(key.clone(), now, card, 7));
    assert!(cache.card(&key).is_some());
    // Another folder's refresh changes nothing here.
    cache.forget_card(&local_key(&tree, "elsewhere"));
    assert_eq!(cache.generation(&key), now);
    cache.forget_card(&key);

    // The same through the command: a slow full walk is overtaken by a
    // refresh of the same folder.
    let scope = |fs: CardFs| Scope {
        fs,
        bound: Some(tree.0.clone()),
        identity: "local".to_string(),
    };
    let old_walk = card_phase_in(
        &state,
        scope(CardFs::Slow(Duration::from_millis(300))),
        tree.path("study"),
        false,
        Full,
    );
    let refresh = async {
        tokio::time::sleep(Duration::from_millis(60)).await;
        tree.file(
            "study/derivatives/glm/dataset_description.json",
            r#"{"Name": "After"}"#,
        );
        card_phase_in(
            &state,
            scope(CardFs::Local),
            tree.path("study"),
            true,
            Descriptions,
        )
        .await
        .unwrap()
    };
    let (old, refreshed) = tokio::join!(old_walk, refresh);
    assert_eq!(refreshed.analyses[0].title.as_deref(), Some("After"));
    // The old walk still answers its own caller, and is not kept.
    assert_eq!(old.unwrap().phase, Full);
    assert!(cache.card(&key).is_none(), "the pre-refresh walk was kept");
    let kept = cache.outline(&key).unwrap().0;
    assert_eq!(kept.analyses[0].title.as_deref(), Some("After"));

    // Generations of many folders are bounded, and a read in flight when
    // they are folded together keeps nothing.
    let before = cache.generation(&key);
    for i in 0..MAX_TRACKED_GENERATIONS + 1 {
        cache.forget_card(&local_key(&tree, &format!("other{i}")));
    }
    assert_ne!(cache.generation(&key), before);
    let tracked = cache.generations.lock().unwrap().by_key.len();
    assert!(tracked <= MAX_TRACKED_GENERATIONS);
}

/// The number of images to expect of a kind is the number of subject folders
/// beside the ones its images are in, never the count of every subject label
/// the walk met.
#[tokio::test]
async fn a_kind_is_measured_against_the_subject_folders_of_its_own_level() {
    let tree = Tree::new();
    tree.images(&[
        "ds/sub-01/anat/sub-01_T1w.nii.gz",
        "ds/sub-02/anat/sub-02_T1w.nii.gz",
        // A stray subject folder at another level.
        "ds/pilot/sub-99/anat/sub-99_T1w.nii.gz",
        // Subject labels in group-level names.
        "ds/group/sub-77_mean.nii.gz",
        "ds/group/sub-78_mean.nii.gz",
    ])
    // A subject with no image of the kind.
    .dir("ds/sub-03");
    let contents = card_of(&tree, "ds").await.contents;
    assert!(!contents.truncated);
    // Every label met is a subject of the folder...
    assert_eq!(contents.subject_count, 6);
    let kind = |path: &str| {
        contents
            .image_kinds
            .iter()
            .find(|kind| kind.path == path)
            .unwrap_or_else(|| panic!("{path} in {:?}", contents.image_kinds))
    };
    // ...but a kind is expected once per subject folder of its own level.
    let anat = kind("anat/sub-*_T1w.nii.gz");
    assert_eq!((anat.count, anat.subject_folders), (2, Some(3)));
    let pilot = kind("pilot/anat/sub-*_T1w.nii.gz");
    assert_eq!((pilot.count, pilot.subject_folders), (1, Some(1)));
    let group = kind("group/sub-*_mean.nii.gz");
    assert_eq!((group.count, group.subject_folders), (2, None));

    // One kind under the subject folders of two folders: no one number.
    let split = Tree::new();
    split.images(&[
        "ds/ses-a/sub-01/x.nii.gz",
        "ds/ses-a/sub-02/x.nii.gz",
        "ds/ses-b/sub-01/x.nii.gz",
    ]);
    let contents = card_of(&split, "ds").await.contents;
    assert_eq!(contents.image_kinds.len(), 1);
    assert_eq!(contents.image_kinds[0].count, 3);
    assert_eq!(contents.image_kinds[0].subject_folders, None);
}
