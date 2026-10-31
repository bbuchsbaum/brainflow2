# Brainflow can out-trace ITK-SNAP by design

Brainflow should build its segmentation module as a first-party **Segment mode** inside the existing slice workspace. A third-party plugin will not work, because Brainflow has no runtime path for plugins to add panels, tools or rendering. The mode should beat ITK-SNAP on structure rather than on AI. ITK-SNAP is still the field's reference after twenty years, and it is fast because it is focused. But its editing state is global and invisible (its own AI brush has erased users' earlier lesions). Its oblique "free rotation" is experimental and leaves secondary images behind. And it has no support for protocols, provenance or multiple raters. Brainflow can win with six contracts:

1. Each segmentation keeps one persistent reference grid (the native T2 for subfields).
2. Editing is safe by default: labels are exclusive within a layer, any label can be locked, and the active constraints show at the cursor.
3. Every heavy operation is a preview the user confirms.
4. Brush previews come from the same code that writes the voxels.
5. Filters are view-only, anchored in millimetres and badged.
6. Every voxel carries provenance, and undo is sparse and has no fixed depth.

On top of these come linked T1/T2/FLAIR panels that show the active label's outline in every panel, a key held to flicker between contrasts, a contrast lens, semi-automatic tools that update live on the GPU, and morphological "fill between slices" with a ghosted preview. AI should be an optional provider that talks to the official nnInteractive server. nnInteractive is the strongest open 3D promptable model on MRI, but its weights are non-commercial and must never be bundled, and nobody has published its accuracy on hippocampus, amygdala or thalamus.

Brainflow's renderer is already most of the way there: 13 volume slots aligned by affine on independent grids, a label LUT with outlines and halos, and linked Compare panels. Its editing stack is nearly empty: immutable volumes, whole-volume uploads only, no undo, no slice zoom, no pen input, no label writer, no filters and no ML runtime. So the first phase is infrastructure. The main open decision is whether segmentation joins a product vision that currently never mentions it.

## ITK-SNAP is fast because it is focused, and fragile because its state is hidden

### Why it is the reference

ITK-SNAP is still the tool every tracer measures against. It has been developed at Penn's PICSL for about two decades.

- The latest stable release is **4.4.0 (9 September 2025)**.
- **4.6.0-beta.1 (28 October 2026)** adds SAM2 prompting, remote files over scp/sftp/http/Flywheel, cooperating windows, a display grid defined by the active segmentation, and **crash-recovery autosave every five minutes** ([v4.6.0-beta1 release](https://github.com/pyushkevich/itksnap/releases/tag/v4.6.0-beta1)).
- It is GPL-3.0 C++ on Qt6/VTK9/ITK5, and **more than 8,000 papers** cite it ([GitHub repo](https://github.com/pyushkevich/itksnap)).

Comparative reviews keep rating it well:

- the most intuitive free segmentation tool ([J Digit Imaging 2023](https://link.springer.com/article/10.1007/s10278-023-00912-y));
- the fastest tool in a pelvic-MRI comparison ([PMC7064712](https://pmc.ncbi.nlm.nih.gov/articles/PMC7064712/));
- as fast as 3D Slicer for glioblastoma, at roughly 18 minutes per case against about 41 in BrainVoyager ([PLOS ONE 2016](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0164891)).

The speed comes from focus. Three synchronized orthogonal views and a 3D view sit beside a small tool set:

- a square, round or watershed-"adaptive" paintbrush;
- a polygon tool with vertex editing and paste-last-polygon;
- a VTK cut-plane scalpel;
- multi-label smoothing;
- an Interpolate Labels dialog.

A dense single-key grammar drives it ([shortcut sheet](https://github.com/pyushkevich/itksnap/tree/master/Documentation/Shortcuts)):

- 1–5 select tools.
- `<`/`>` cycle the drawing label, and Ctrl+`<`/`>` cycle the draw-over label.
- A/D/S change and toggle segmentation opacity.
- Ctrl+V pastes the last polygon.

The semi-automatic mode trains a random forest on brushstrokes across every loaded modality. It turns the result into a speed image and evolves a 3D level set from seed bubbles. On BRATS gliomas it was **2.5–5× faster than manual tracing**, with accuracy competitive with top challenge entries ([Neuroinformatics 2018](https://springeropen.altmetric.com/details/44236662)). Underneath, undo stores run-length-encoded deltas per commit within a memory budget, not whole-volume snapshots ([UndoDataManager.h](https://raw.githubusercontent.com/pyushkevich/itksnap/master/Logic/Framework/UndoDataManager.h)). Brainflow should copy that choice.

### Weaknesses that are structural, not cosmetic

**Hidden editing state.** Editing runs on one active tool, one active label and one global "paint over" rule ([GlobalState.h](https://raw.githubusercontent.com/pyushkevich/itksnap/master/Logic/Framework/GlobalState.h); [neuroimaging-core-docs](https://neuroimaging-core-docs.readthedocs.io/en/latest/_sources/pages/itk-snap.rst.txt)). The rule defaults to the clear label; it can also be all labels, all visible labels, or one protected label. The rule is invisible where the brush lands. The cost became plain when AI arrived. Users of the 4.4 nnInteractive brush found that **new AI additions erased earlier manual lesions on the same label**. The maintainer wrote that he is "still working out the best UI design for adding multiple objects" ([issue #217](https://github.com/pyushkevich/itksnap/issues/217)).

**Missing label ergonomics.** These are all open requests ([open issues](https://github.com/pyushkevich/itksnap/issues?q=is%3Aissue+is%3Aopen)):

- picking the active label from a voxel (#208);
- batch-editing label display (#151);
- saving a default window/level (#22 from 2020, #167 from 2025);
- customizable hotkeys (#294, opened October 2026).

**Oblique work is the deepest gap.**

- Free rotation has been "experimental" since 4.2.
- It maps 2D edits wrongly in some cases, and the owner prefers not to change "fragile code" ([#176](https://github.com/pyushkevich/itksnap/issues/176)).
- It does not rotate additional images (#228).
- The October 2026 cleanup disabled the AI paintbrush under rotation entirely ([PR #270](https://github.com/pyushkevich/itksnap/pull/270)).

**The snake struggles.** It is "poorly suited for non-isotropic images" ([ITK-SNAP tips](https://www.itksnap.org/docs/TutorialSectionTipsAndTricks.html)), and it leaks past boundaries ([IOP comparison](https://iopscience.iop.org/article/10.1088/1742-6596/1386/1/012113/pdf)).

**AI needs heavy setup.** It requires a separate Python server and **an NVIDIA GPU** ([DLS quick start](https://raw.githubusercontent.com/pyushkevich/itksnap-dls/main/docs/quick_start.md)). The server still receives full-size images ([#234](https://github.com/pyushkevich/itksnap/issues/234)). And "the DLS paths are not covered by CI" ([PR #270](https://github.com/pyushkevich/itksnap/pull/270)).

**Format gaps.** It does not read FreeSurfer `.mgz` (#295) or OME-Zarr (#150).

**Manual work in it is still hard on people.** In a five-observer vestibular-schwannoma study, manual ITK-SNAP tracing took **479 s versus 167 s** for a semi-automated tool. Yet that tool's "unpredictable algorithm behaviour" raised frustration and mental effort ([PMC7419453](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7419453/)). Predictability matters as much as raw speed.

### What this means for Brainflow

Two conclusions follow. First, ITK-SNAP is accelerating. A developer opened a "JavaScript based UI prototype" issue on 7 October 2026 ([#266](https://github.com/pyushkevich/itksnap/issues/266)). A dated Qt look is therefore not a durable advantage, although many users will stay on 3.8–4.4 for years.

Second, Brainflow must first match the baseline that makes ITK-SNAP fast:

- single-key tool switching;
- label cycling;
- one-key opacity and visibility toggles;
- paste-last-polygon;
- draw-over semantics;
- interpolation;
- import and export of ITK-SNAP label description files;
- a synchronized three-plane cursor.

It should then win on what ITK-SNAP's architecture makes hard: a visible, safe editing model; every layer resliced together on any plane; and the protocol, provenance and QC layer ITK-SNAP has never had.

## Rival tools converged on locks, previews and named confirms

### 3D Slicer: the richest model, and the clearest warnings

3D Slicer's Segment Editor has the richest open-source model.

- A segmentation holds overlapping segments in shared labelmap "layers", with one editable source representation ([Slicer image_segmentation.md](https://github.com/Slicer/Slicer/blob/main/Docs/user_guide/image_segmentation.md)).
- A global masking triad constrains every effect: editable area, editable intensity range, and an overwrite policy of "overwrite all", "overwrite visible" or "allow overlap".
- Heavy effects such as Grow from seeds and Fill between slices follow an **Initialize → live preview with auto-update → Apply or Cancel** contract that keeps seeds editable ([Slicer segmenteditor.md](https://github.com/Slicer/Slicer/blob/main/Docs/user_guide/modules/segmenteditor.md)).
- Per-segment status flags cost little and support QA: not started, then in progress automatically on first edit, then completed or flagged for a reviewer.

The same documentation shows the cost of hidden state:

- The first FAQ answer to "cannot edit the segments" is to reset masking to its defaults.
- Users ask for a per-segment lock that does not depend on visibility ([Discourse 35156](https://discourse.slicer.org/t/locking-a-segment-for-edits/35156)).
- Undo keeps only **the last 10 full states**.
- Developers' rule of thumb puts peak memory near **10× the input volume** ([Slicer issue 6982](https://github.com/Slicer/Slicer/issues/6982)).

### MITK: the strongest protection model

All of the following comes from the [MITK segmentation manual](https://github.com/MITK/MITK/blob/master/Plugins/org.mitk.gui.qt.segmentation/documentation/UserManual/QmitkSegmentation.dox).

- Labels sit in groups: exclusive within a group, free to overlap across groups.
- **Label instances are locked by default and "behave like cookie cutters".**
- Hovering a row highlights its voxels, and a search bar centres the views on a label.
- JSON suggestion lists can enforce a controlled vocabulary with maximum-occurrence rules.
- The nnInteractive tool shows a preview that is committed through a button naming the target label and its colour ("Confirm Liver").
- It separates **interaction undo** (`U`, the last unconfirmed prompt) from **document undo** (Ctrl+Z, a confirmed result).
- The crosshair freezes while a manual tool is active, so the view does not jump under the pen.
- 3D interpolation builds a surface from contours drawn on planes in any orientation. That path has no undo, though.
- The AI tool needs "several gigabytes" and an RTX 4090 for about a second per interaction.

### Lighter tools: precise ideas worth taking

**Kitware VolView** ([VolView toolbar.md](https://github.com/Kitware/VolView/blob/main/docs/toolbar.md)):

- Each segment row has Reveal (jump to its extent), Lock and Hide.
- An eyedropper works when you **hold `d` mid-stroke**.
- "Sync Views" makes the other views follow the brush slice.
- Post-processing "never takes voxels another segment holds".

**Cornerstone3D:**

- It computes the brush cursor and the fill from the same data, so "the sweep volume painted into the labelmap matches what was rendered on screen" ([cursor-strategies.md](https://github.com/cornerstonejs/cornerstone3D/blob/main/packages/docs/docs/concepts/cornerstone-tools/segmentation/cursor-strategies.md)).
- It fills a planar voxel slab on oblique planes.
- It offers a **dynamic-threshold brush**: the range is seeded from the neighbourhood of the click and extends as you drag ([dynamicThreshold.ts](https://github.com/cornerstonejs/cornerstone3D/blob/main/packages/tools/src/tools/segmentation/strategies/compositions/dynamicThreshold.ts)).

**Freeview** ([Freeview ToolWindowEdit.ui](https://github.com/freesurfer/freesurfer/blob/dev/freeview/ToolWindowEdit.ui)):

- It limits drawing to intensity ranges on a separate **reference volume**.
- It can "draw connected only".
- Its recon-edit mode writes fixed values so FreeSurfer can recognize manual edits. This is an early form of provenance.

**FSLeyes** offers select-then-apply editing and cross-image selection, so a lesion seen on T1 can be filled into a FLAIR mask ([FSLeyes editing_images.rst](https://github.com/pauldmccarthy/fsleyes/blob/master/userdoc/editing_images.rst)).

**napari** has the cleanest minimal grammar ([napari labels.md](https://github.com/napari/docs/blob/main/docs/howtos/layers/labels.md)): numeric tool keys, `[`/`]` for brush size, `m` for a new label and `b` for preserve-labels. However, it resets undo when the slice changes.

**NiiVue** runs GrowCut on the GPU, and its click-to-segment threshold follows the scroll wheel ([NiiVue drawing.mdx](https://github.com/niivue/niivue/blob/main/packages/docs/docs/drawing.mdx)).

### Side-by-side comparison

| Capability | ITK-SNAP 4.4–4.6 | 3D Slicer | MITK | Best idea elsewhere | Brainflow target |
|---|---|---|---|---|---|
| Overwrite protection | One global paint-over dropdown | Overwrite all / visible / allow overlap; no per-segment lock | Locked-by-default "cookie cutters" in groups | Per-segment lock (VolView, Cornerstone) | Exclusive within a layer, per-label lock, constraints shown at the cursor |
| Heavy operations | Modal snake wizard; batch interpolation dialog | Initialize → auto-update preview → Apply | Preview → "Confirm <label>" | Auto-accept interpolation (OHIF 3.12) | Named proposal layer, Confirm <label>, two-level undo |
| Undo | RLE deltas, memory-budgeted | Last 10 full states | App-wide; 1-level AI undo | — | Sparse brick deltas, byte budget, named history panel |
| Interpolation | Four methods, per axis, no preview | Morphological, any orientation, previewed | 2D suggestions; 3D RBF from any plane | — | Live ghosted morphological interpolation with keyframe list |
| Intensity-aware painting | Watershed adaptive brush | Editable intensity range; Local Threshold extension | Region growing by drag | Reference-volume ranges (Freeview); dynamic threshold (Cornerstone) | Range gate from any loaded contrast plus dynamic threshold |
| Multi-contrast / oblique | Thumbnails or tiles; experimental rotation of main image only | Compare Volumes; Layer Reveal checkerboard | Not assessed | Per-overlay interpolation (FSLeyes) | Linked panels on any plane, contour echo, flicker, lens |
| AI | nnInteractive and SAM2 via a separate server; NVIDIA GPU | SlicerNNInteractive | Built-in nnInteractive tool | In-browser SAM assist (OHIF) | Optional provider; proposals never overwrite |
| Review / QA | None found | Per-segment status flags | Task list view | Consensus and adjudication (RedBrick, Flywheel) | Status, review mode, rater diff, metrics |

### What the convergence tells us

The convergence is clear. Per-segment locks plus a small set of overwrite modes are a de facto standard across Slicer, Cornerstone and VolView ([Cornerstone overwritePolicy.ts](https://github.com/cornerstonejs/cornerstone3D/blob/main/packages/tools/src/tools/segmentation/strategies/utils/overwritePolicy.ts)). Preview-then-confirm is the norm for anything heavy.

The usability evidence is thin and dated, but it consistently favours a small default tool set. 3D Slicer is repeatedly judged slower or harder to learn than ITK-SNAP, at similar accuracy ([PMC9323631](https://pmc.ncbi.nlm.nih.gov/articles/PMC9323631/); [PMC7064712](https://pmc.ncbi.nlm.nih.gov/articles/PMC7064712/)). That is why Slicer itself moved advanced effects into an extension, so that "new users … learn basic tools first" ([SegmentEditorExtraEffects](https://github.com/lassoan/SlicerSegmentEditorExtraEffects)). Clinicians also mix tools within one structure: painting is faster than freehand, and they draw with one tool and adjust with another ([J Digit Imaging](https://link.springer.com/article/10.1007/s10278-015-9839-8)). Switching tools therefore has to be instant.

No open-source desktop tool documents three things, which leaves them open:

- pen-pressure brushes;
- a command palette for segmentation actions;
- built-in multi-rater consensus.

## Interactive AI is strong on organs and unproven on small brain structures

### nnInteractive leads, with licence and evidence caveats

nnInteractive (DKFZ, March 2025; v2.5.0 in June 2026) is the de facto reference for 3D promptable segmentation ([nnInteractive README](https://github.com/MIC-DKFZ/nnInteractive); [arXiv 2503.08373](https://arxiv.org/abs/2503.08373)).

- It takes positive and negative points, 2D boxes, scribbles and lassos drawn on the viewed slice, and returns a 3D mask.
- It was trained on **64,518 volumes and 717,148 objects** across CT, MRI, PET and microscopy.
- It already plugs into napari, MITK, Slicer, ITK-SNAP and OHIF.
- In one CVPR 2025 challenge team's validation table it scored **MRI Dice 0.73 against 0.39 for SAM-Med3D** ([arXiv 2510.03189](https://arxiv.org/html/2510.03189v1)).
- Lasso was its best refinement prompt.
- Its user study (six experts, three tasks) measured **179 ± 114 s per case versus 635 ± 343 s manual**, about 72% faster ([arXiv 2503.08373 html](https://arxiv.org/html/2503.08373)).

Three caveats matter for Brainflow:

1. The paper is a preprint, and the "1st place" claim is the team's own.
2. The input is a **single channel**, so T1 and T2 cannot be fed in together.
3. The weights are **CC BY-NC-SA 4.0**, and the code reports this through `session.license` ([README](https://github.com/MIC-DKFZ/nnInteractive)).

An ISBI 2026 robustness study adds that the model faithfully follows dilated or eroded mask prompts past the true boundaries ([arXiv 2601.16383](https://arxiv.org/abs/2601.16383)). Sloppy prompts produce sloppy masks.

### The rest of the field

For brain MRI, the alternatives are superseded or carry licence problems.

- **SAM 3** beats SAM 2 as a zero-shot propagator across 16 medical datasets ([MIDL 2026](https://proceedings.mlr.press/v315/chakrabarty26a.html)). It is also "inconsistent" on medical data ([MedSAM3](https://arxiv.org/abs/2511.19046)) and ships under a custom licence.
- **MedSAM2** weights are for research and education only ([HF card](https://huggingface.co/wanglab/MedSAM2)).
- **SAM-Med3D** is Apache-2.0 but weak on MRI, and it crops to 128³ ([GitHub](https://github.com/uni-medical/SAM-Med3D)).
- **VISTA3D** is CT-only. NVIDIA's **NV-Segment-CTMR** adds an MRI_BRAIN mode with 133 substructures, but it is automatic, non-commercial, and needs skull stripping, bias correction and MNI alignment ([Project-MONAI/VISTA](https://github.com/Project-MONAI/VISTA/tree/main/vista3d)).
- **ScribblePrompt** is 2D but runs in real time on a CPU. In an expert study it cut annotation time by 28% compared with SAM ([ECCV 2024](https://www.ecva.net/papers/eccv_2024/papers_ECCV/html/5664_ECCV_2024_paper.php)).

### The evidence gap on brain structures

Crucially, **no peer-reviewed or preprint result reports Dice for any of these models on hippocampus, amygdala, thalamus or subcortical nuclei**. A MICCAI 2025 evaluation that includes a whole-hippocampus task found that SAM2 degrades with poor contrast and complex shapes, and that adaptive zooming improves convergence ([arXiv 2510.09499](https://arxiv.org/abs/2510.09499)). An independent peer-reviewed workload study found that only **30% of SAM 2 masks for femoral-bone MRI and 53% for CT liver tumours were accepted without edits** ([PMC12849165](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12849165/)).

For low-contrast brain structures, the realistic expectation is therefore a modest speed-up: perhaps 2–4× once AI and interpolation are used well. That figure is an extrapolation, not a measurement, and most of the remaining time goes to boundary correction. Brainflow should design for fast correction loops, not one-click claims.

### Deployment favours a sidecar over in-process Rust inference

Every viewer that ships nnInteractive uses a thin client talking to a GPU server. The official `nninteractive-server` ([README](https://github.com/MIC-DKFZ/nnInteractive); [arXiv 2503.08373 html](https://arxiv.org/html/2503.08373)):

- loads the model once and serves concurrent sessions (three by default);
- ships as a Docker image;
- wants about **10 GB of VRAM** (under 6 GB for small objects);
- runs on a CPU, slowly;
- has a worst-case latency above **3.5 s for large organs**, because cost grows with object size.

The authors of the Slicer extension note that this split also lets macOS act as a client, "since nnInteractive itself only runs on Windows and Linux" ([arXiv 2504.07991](https://arxiv.org/abs/2504.07991)). ITK-SNAP's DLS server uploads gzip float32 volumes and returns gzip+base64 masks. A client that disconnects without ending its session "keeps the image in GPU memory" ([itksnap-dls developer.md](https://raw.githubusercontent.com/pyushkevich/itksnap-dls/main/docs/developer.md)).

In-process Rust inference is not ready for 3D models:

- candle exposes no 3D convolution ([candle-nn source](https://docs.rs/crate/candle-nn/latest/source/src/lib.rs)).
- burn's ONNX importer passes 1,185 of 1,765 backend node tests, and Conv3d support is unconfirmed ([burn-onnx wiki](https://github.com/tracel-ai/burn-onnx/wiki)).
- `ort` 2.0 is still a release candidate ([ort docs.rs](https://docs.rs/crate/ort/latest/source/src/ep/mod.rs)).

The realistic in-process path is 2D. SAM 2.1 encoder and decoder ONNX exports are mature, while full slice-propagation exports are still partial ([samexporter](https://anylabeling.nrl.ai/docs/samexporter)).

### Classical tools and interpolation remain the dependable core

**Classical tools.** The ones most likely to feel good on small, low-contrast structures are:

- an intensity-gated brush;
- a bounded "adaptive" flood fill;
- seeded multi-label growing with live preview.

Some precedents:

- Slicer's Grow from seeds is a Fast GrowCut variant about **10× faster than the original**, with interactive updates, masking and locality ([Slicer FastGrowCut](https://slicer.org/wiki/Documentation/4.10/Modules/FastGrowCut)).
- GrowCut is a cellular automaton, which maps naturally onto ping-pong compute passes.
- Random walker has had GPU implementations since Grady's 2005–2006 work ([PAMI 2006](https://www.ncbi.nlm.nih.gov/pubmed/16686030/)).
- ITK-SNAP's random-forest presegmentation is still **the only proven way to use T1 and T2 together** in an interactive tool ([EMBC 2016](https://pmc.ncbi.nlm.nih.gov/articles/PMC5493443)).
- Level tracing, by contrast, takes "trial and error" to place on noisy MRI ([Slicer forum](https://discourse.slicer.org/t/level-tracing-segment-editor-effect/949)).

**Slice interpolation.** The robust standard is **morphological contour interpolation** (Albu et al. 2008). Zukić et al. ported it to ITK explicitly "to ease manual segmentation in ITK-SNAP" ([Insight Journal 977](https://insight-journal.org/pdfs/977.pdf)). It matches shapes on the segmented slices by overlap, aligns them, and takes the median of a sequence of one-pixel dilations. It recurses to cross gaps of several slices. Slicer's Fill between slices uses it in any orientation, with preview, and has interpolated all visible segments since 5.8 ([Slicer 5.8 source](https://apidocs.slicer.org/v5.8/SegmentEditorFillBetweenSlicesEffect_8py_source.html)).

Signed-distance (shape-based) interpolation is simpler and suits the GPU: jump flooding computes distance fields in O(log N) passes ([Rong & Tan 2006](https://www.comp.nus.edu.sg/~tants/jfa/i3d06.pdf)). But linear SDF blending leaves creases at the key slices ([Csébfalvi et al. 2002](https://www.cg.tuwien.ac.at/research/vis/adapt/VMV2002/paper.pdf)).

Sparse-annotation studies suggest that drawing **about 20–35% of slices** recovers full-annotation quality, though none studied subcortical structures ([PMC10434268](https://pmc.ncbi.nlm.nih.gov/articles/PMC10434268/); [arXiv 1906.07367](https://arxiv.org/pdf/1906.07367)). Deep propagation needs fewer key slices but fails in typical ways. SAM 2 works best from the object's centre slice, propagated in both directions ([arXiv 2408.02635](https://arxiv.org/abs/2408.02635)), and it keeps propagating after the object ends ([MIDL 2026](https://proceedings.mlr.press/v315/chakrabarty26a.html)).

**Post-processing traps.** Gaussian smoothing shrinks segments, and joint multi-label smoothing can bridge separate parts ([Slicer forum](https://discourse.slicer.org/t/joint-smoothing-can-create-spurious-bridges-between-separate-parts-of-anatomy-in-same-segment/20765)). Every such operation therefore needs a preview of the voxels it will change.

## Contrast aids help only as labelled, view-only lenses in world space

### Protocols trace raw high-resolution T2, so filters are hints

The protocols that define elite tracing are written on raw contrast:

- **Berron's 7T medial temporal lobe protocol** traces T2 TSE at **0.44 × 0.44 × 1.0 mm**, oblique-coronal to the hippocampal long axis. T2 was chosen because it shows the dark SRLM band. Raters reached Dice above 0.78 and ICC 0.76–0.99 ([PMC5476466](https://pmc.ncbi.nlm.nih.gov/articles/PMC5476466)).
- **DeKraker's 7T unfolding work** traced the dark band first (Dice 0.70), then dilated it to start the grey-matter label ([ISMRM 2017](https://cds.ismrm.org/protected/17MProceedings/PDFfiles/0697.html)).
- **The HSG body protocol** targets 3T T2 at about 0.42 mm in-plane ([bioRxiv 2025.04.29.651039](https://www.biorxiv.org/content/10.1101/2025.04.29.651039v1)).

Subregion borders "cannot always be seen on MRI scans, even at 7T", which is why protocols fall back on geometric rules ([Hickling et al. 2024](https://discovery.ucl.ac.uk/id/eprint/10190922/1/Hippocampus%20-%202024%20-%20Hickling%20-%20Automated%20protocols%20for%20delineating%20human%20hippocampal%20subfields%20from%203%20Tesla%20and%207%20Tesla.pdf)).

This research found no published hippocampal, amygdala or thalamic protocol that recommends CLAHE, non-local means, Hessian or any other enhancement filter. It also found no evidence that any filter improves inter-rater reliability. Filters are legitimate as optional, clearly labelled, view-only aids, and every one of them can create, move or erase a boundary.

| Aid | What it can reveal for tracing | Main risk | Where it should run |
|---|---|---|---|
| Window/level, gamma, sigmoid, monotonic curve LUT | Everything; gamma separates the SRLM from CA grey matter | Clipping; shifts the apparent position of soft edges | Fragment shader |
| Local z-score (σ in mm) | Flattens 7T B1 shading across the medial temporal lobe | Amplifies noise in flat regions; halos | Per-reslice compute |
| CLAHE, 2D or 3D, with tiles in mm | Amygdala–hippocampus junction; thalamic edges | Same tissue reads differently by location; tile seams | Per-reslice compute, or 3D tile LUTs applied per slice |
| Unsharp mask | Crisper SRLM and alveus | Overshoot halos that mimic dark bands | Shader or per-reslice compute |
| Gradient magnitude or edge overlay | Steepest boundary; agreement across contrasts | Double edges around thin bands; misregistration | Per-reslice compute |
| 2D Hessian valley, black top-hat | Thin dark bands (SRLM, hippocampal sulcus) | Vessels and CSF slivers mimic targets | Per-reslice compute |
| Bilateral, guided, anisotropic diffusion | Edge-preserving denoising of 7T TSE | Erases edges below threshold; a T1-guided filter imports T1 edges into T2 | Per-reslice compute |
| Non-local means, BM4D, total variation | Clean high-resolution T2 | Over-smoothing; TV staircasing creates false edges | Background derived volume |
| Coherence-enhancing diffusion | Continuity of interrupted bands | Invents continuity across real gaps | Not a default |
| T1w/T2w ratio | Myelin contrast; partial bias cancellation | Misregistration creates edges exactly at boundaries | Shader, if co-registered |
| SynthSR-type learned contrast | T1-like context from clinical scans | Hallucinated anatomy; 1 mm cannot resolve subfields | External background job |

### Two rules that make filters safe and fast

1. **Compute in world millimetres on the displayed reslice.** Define tiles, kernels and structuring elements in mm and anchor them to the world origin, so results do not "swim" with pan and zoom.
2. **Never write a filtered value to the image or label volume.** Every edit maps screen → world → reference-grid voxel through the unfiltered geometry.

### Where each kind of filter runs

**Point operations** belong in the fragment shader.

**Short per-reslice compute chains** suit separable blurs, local z-scores, 2D Hessians, top-hats and a tile-histogram CLAHE. A 1,024-bin u32 histogram uses 4 KB of the **16 KB baseline workgroup storage** in WebGPU ([W3C WebGPU](https://www.w3.org/TR/webgpu/)).

**Background jobs** should handle 3D NLM, BM4D, N4, multi-scale 3D Hessians and learned contrasts, writing derived f16 volumes.

Precedents exist:

- The bilateral grid runs edge-aware filtering and local histogram equalization in real time on GPUs, and its authors demonstrated medical contrast enhancement ([MIT bilateral grid](https://groups.csail.mit.edu/graphics/bilagrid/)).
- A real-time 3D CLAHE with "focused" (block) and "masked" (organ) variants has been reported ([ISVC 2020](https://easychair.org/smart-slide/slide/XhJ6)).
- 3D NLM for MRI runs in clinically feasible time in CUDA ([Cuomo et al. 2014](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4082863/)).

No WGSL implementation of CLAHE, the bilateral grid or NLM was found, so those are new work.

**Memory** is manageable but not free (arithmetic, not measurement): a 0.5 mm whole head is about 92 M voxels, or 185 MB per f16 derived volume, while a 0.4 × 0.4 × 2 mm hippocampal slab is about 31 MB in f32. For 7T MP2RAGE, suppressing background noise in the "uniform" image is a cheap and well-evidenced derived volume ([O'Brien et al. 2014](https://pmc.ncbi.nlm.nih.gov/articles/PMC4059664/)).

### Flicker and contour echo beat static side-by-side for cross-contrast checks

Gleicher's three categories cover every comparison display: juxtaposition, superposition and explicit encoding ([Gleicher et al. 2011](https://experts.colorado.edu/display/pubid_153663)). The best radiology evidence favours alternating images over static side-by-side views:

- For glioma progression on brain MRI, change detection and subtraction, with or without flicker, were more sensitive than side-by-side reading ([AJNR 2011](https://www.ajnr.org/content/32/9/1652)).
- In a pilot, toggle mode gave 23 mammographers about **6 s faster** decisions ([Drew et al. 2015](https://aval.psych.utah.edu/pdf/Drew%20et%20al.,%202015%20JMI.pdf)).

No study has tested these displays for segmentation boundary placement, so the transfer is plausible rather than proven.

Existing tools offer:

- ITK-SNAP: tiled or thumbnail layouts with a linked cursor ([EMBC 2016](https://ieeexplore.ieee.org/document/7591443));
- Slicer: the Layer Reveal cursor, a live checkerboard that follows the mouse through pan, zoom and scroll ([Slicer Compare Volumes](https://slicer.readthedocs.io/en/5.6/user_guide/modules/comparevolumes.html));
- FSLeyes: outline-only overlays ([FSLeyes overlays](https://open.oxcin.ox.ac.uk/pages/fsl/fsleyes/fsleyes/userdoc/overlays.html)).

The design below ranks five display modes, in this order:

1. **Linked side-by-side panels** that share crosshair, plane, zoom and pan, with **the active label's outline echoed on every panel while painting**.
2. **A hold-to-flicker key** that swaps the contrast, or raw and filtered, in place, so the eye never moves.
3. **A magic lens** attached to the cursor, showing another contrast, a filter, or 2–8× nearest-neighbour magnification.
4. **A thin edge overlay** of contrast B on contrast A.
5. **Colour fusion, checkerboard and swipe**, kept mainly for registration QA, because hue edges read as anatomy and Brainflow reserves colour for data.

### Trace on the acquisition grid and render voxels honestly

Geometry decides more than filters do. Subfield protocols acquire anisotropic oblique slabs: 0.4 × 0.4 × 2.0 mm for ASHS, 0.44 × 0.44 × 1 mm for Berron. The segmentation's reference grid should therefore be the **native T2 grid**, with T1 and other images resampled for display only. Resampling T2 to isotropic before tracing invents through-plane voxels that look like evidence ([PICSL ASHS](https://picsl.upenn.edu/?p=1263)).

Other tools agree:

- ITK-SNAP keeps manual segmentation in the main image's voxel space and shows other images at their native resolution ([changelog](https://www.softpedia.com/progChangelog/itk-Snap-Changelog-75656.html)).
- Slicer fixes the labelmap grid at the first source volume and forbids painting outside it. It also warns of "striping" when thin segments are edited obliquely ([Slicer segmenteditor.md](https://github.com/Slicer/Slicer/blob/main/Docs/user_guide/modules/segmenteditor.md)).

**Display interpolation:**

- Default to linear interpolation for intensities.
- Offer a one-key nearest-neighbour "true voxels" mode.
- Allow cubic only when it is prefiltered, so it equals the data at voxel centres, as FSLeyes' `true_spline` does ([FSLeyes overlays](https://open.oxcin.ox.ac.uk/pages/fsl/fsleyes/fsleyes/userdoc/overlays.html)).
- Avoid Catmull-Rom and Lanczos: their ringing can mimic exactly the thin dark bands that raters look for.

**Label display:**

- Labels are always nearest-neighbour.
- Outlines follow true reference-grid voxel edges.
- A faint voxel grid appears beyond roughly eight screen pixels per voxel.
- The active label switches to outline-only while drawing, so the intensity edge stays visible under the brush.
- The brush preview shows the exact voxel footprint a click will paint; on a 2 mm slab, that is the whole slab.

## Protocols, raters and hands define the real requirements

### Disagreement concentrates at landmarks and structure ends

Expert protocols share a shape:

- one primary tracing plane, with orthogonal views for checks;
- slab boundaries defined by landmarks;
- rules specific to the contrast;
- several structures under a fixed numeric scheme in one file.

Their value is measurable.

- **HarP.** The EADC-ADNI harmonized protocol split the hippocampus into four segmentation units, so that protocols could agree on whether to include the alveus/fimbria and tail ([HarP standard of reference](https://www.researchgate.net/publication/273068047_HarP_The_EADC-ADNI_Harmonized_Protocol_for_manual_hippocampal_segmentation_A_standard_of_reference_from_a_global_working_group)). Tracers' agreement rose from **ICC 0.44/0.43 (left/right) with their local protocols to 0.88/0.89 with HarP** ([Frisoni et al. 2015](https://pubmed.ncbi.nlm.nih.gov/25267715/)).
- **Subfields.** When 21 groups applied their own subfield protocols to one subject, disagreement was largest at the **CA1/subiculum boundary** and in the anterior hippocampus ([Yushkevich et al. 2015](https://preston.clm.utexas.edu/wp-content/uploads/2019/09/yushkevich_etal_neuroimage_2015.pdf)).
- **HSG.** The harmonized body protocol came out of a Delphi process grounded in multi-rater histology. The tail protocol found a novice rater about as reliable as the experts ([HSG tail bioRxiv](https://www.biorxiv.org/content/10.1101/2025.11.20.689476v1.full)).
- **Medial temporal cortex.** Its rules depend on the depth and continuity of the collateral sulcus, which vary between hemispheres ([Konstanz 7T protocol paper](https://kops.uni-konstanz.de/server/api/core/bitstreams/821ae68d-abba-42bd-91aa-aacdce7f4fdb/content)). A protocol can therefore depend on the anatomy in front of the rater.
- **WMH lesions** add partial-volume rules. Challenge references were drawn as contours, and voxels more than 50% inside were counted. The tracings were then peer-reviewed and corrected in a consensus meeting ([Kuijf et al. arXiv 1904.00682](https://arxiv.org/pdf/1904.00682)).
- **BraTS** fuses earlier algorithms' outputs and refines them by hand in ITK-SNAP ([arXiv 2107.02314](https://arxiv.org/pdf/2107.02314)). Neuroradiologists then approve each case or send it back ([arXiv 2404.15009](https://arxiv.org/pdf/2404.15009)).

The costs are large:

- about **3 hours per subject for hippocampus plus amygdala** ([PMC8715642](https://pmc.ncbi.nlm.nih.gov/articles/PMC8715642/));
- "multiple hours" for thalamic nuclei, against under 4 minutes for the automated THOMAS method ([PMC7530079](https://pmc.ncbi.nlm.nih.gov/articles/PMC7530079));
- about **20 ± 5 hours of correction per infant subject** after a U-Net first pass ([arXiv 2007.02096](https://arxiv.org/pdf/2007.02096)).

Correcting a presegmentation is now the dominant mode of work. Many of these figures come from abstracts and should be spot-checked before they appear in user documentation.

### No tool ships protocol guidance, provenance or rater agreement

Guidance lives outside the tools. This research found no built-in protocol mode in ITK-SNAP or Slicer. The closest precedents are:

- Flywheel's Read Protocols, which bundle viewer configuration, labels, form logic and reader instructions per task ([Flywheel docs](https://docs.flywheel.io/user/workflow/tasks/user_introduction_to_read_tasks/));
- the HarP qualification platform, whose **point-by-point visual feedback against benchmark tracings significantly raised Jaccard overlap** between training phases ([Duchesne et al. 2015](https://adni.loni.usc.edu/adni-publications/Duchesne_2015_AlzDem.pdf)).

**Reliability metrics.** Practice pairs ICC with Dice or Jaccard. Boundary metrics such as HD95 and NSD are increasingly recommended, because Dice misses boundary errors ([Metrics Reloaded](https://arxiv.org/pdf/2206.01653)). But distance metrics differ critically between open-source implementations ([arXiv 2410.02630](https://arxiv.org/pdf/2410.02630v2)), so a tool must pin and document one implementation.

**Consensus.** STAPLE estimates a probabilistic consensus plus each rater's sensitivity and specificity ([Warfield et al.](https://pmc.ncbi.nlm.nih.gov/articles/PMC1283110)). Commercial platforms add linked blinded reads, automatic adjudication tasks, and a tie-breaker stage below an IoU threshold ([RedBrick consensus](https://app.redbrickai.com/docs/project-pages/multiple-labeling/consensus/home.md)).

**Open opportunities.** No tool documents any of the following. Each is an opportunity to stand out, not established practice:

- per-voxel provenance (manual vs AI);
- branching edit histories;
- comments anchored in world space;
- a split of tracing time into navigation, drawing and correction.

### Formats: integer NIfTI plus four label-table dialects

**The label volume.** Interoperability needs an integer NIfTI label volume with **`intent_code` 1002 (NIFTI_INTENT_LABEL)** and the reference image's sform and qform intact ([NIfTI-1 intent codes](https://nifti.nimh.nih.gov/nifti-1/documentation/nifti1fields/nifti1fields_pages/group__NIFTI1__INTENT__CODES.html/view.html)). Write it as NIfTI-1, because ITK only writes NIfTI-1 ([ITK Discourse](https://discourse.itk.org/t/nifti-1-or-nifti-2-data-format/4330)).

**Label tables** come in four dialects:

- ITK-SNAP's `IDX R G B A VIS MSH "LABEL"` text;
- FreeSurferColorLUT, which is versioned, with numbering that differs between releases;
- BIDS `dseg.tsv`: `index` and `name` are required, colour and abbreviation are optional, and extra columns are allowed ([BIDS derivatives](https://bids-specification.readthedocs.io/en/stable/derivatives/imaging.html));
- Slicer `.seg.nrrd`, which stores each segment's layer, value and coded terminology, and becomes 4D when segments overlap ([Slicer developer guide](https://slicer.readthedocs.io/en/5.6/developer_guide/modules/segmentations.html)).

**Clinical exchange** adds:

- DICOM SEG with Supplement 243's new LABELMAP type: 8- or 16-bit indices, one non-overlapping set per instance ([Sup 243](https://www.dicomstandard.org/News-dir/ftsup/docs/sups/sup243.pdf));
- RTSTRUCT polygons, which dcmqi deliberately does not support ([dcmqi FAQ](https://qiicr.gitbook.io/dcmqi-guide/faq)).

Overlap and hierarchy cannot live in a single integer volume. The internal model therefore needs layers and a parent column in the label table, and should export to the flattest form each target accepts.

### Pens beat mice for contours, but WebViews drop pen pressure

Small controlled studies favour pens:

- In liver volumetry (n = 70), a pen tablet cut mean volume error from **1.8% to 0.2%** and CT segmentation time from 610 to 457 s ([CORE](https://core.ac.uk/works/3907345)).
- With 11 radiologists, a tablet lowered both contour error and time on simulated lesions ([Springer Medicine](https://www.springermedicine.com/computer-input-devices-neutral-party-or-source-of-significant-er/21453926)).
- A pen gave no advantage for navigating oblique head-MRI planes ([HS Flensburg 2017](https://hs-flensburg.de/sites/default/files/2022-02/muc2017_radpen_paper.pdf)).

Ergonomics matter too: 60.2% of 727 breast imagers reported repetitive-strain symptoms ([Diagnostic Imaging](https://www.diagnosticimaging.com/view/breast-imaging-radiologists-risk-repetitive-stress-injury)).

None of this evidence concerns brush size controlled by pressure, and a variable size hurts reproducibility. The pen should first be a perfect absolute pointer.

The engineering risk is the WebView:

- Safari/WebKit has not recognized Wacom styluses as pens ([w3c/pointerevents #467](https://github.com/w3c/pointerevents/issues/467)).
- A Tauri developer on Linux reported pressure stuck at 0 ([r/WebKit](https://lr.eu.psf.lt/r/WebKit)).
- Safari gained `getPredictedEvents` and `getCoalescedEvents` only in 18.2, and early coalesced events lacked `pointerId` ([caniuse](https://caniuse.com/mdn-api_pointerevent_getpredictedevents); [flutter/engine #56903](https://github.com/flutter/engine/pull/56903)).

Pressure and tilt on macOS and Linux therefore need a native side channel (NSEvent tablet data on macOS, GTK device axes on Linux). Windows WebView2 is probably fine on its own, but that is unverified.

## Brainflow already renders like a tracing tool but cannot yet edit

### What already exists

Brainflow's display stack is a strong foundation.

**Multiple grids align for free.** A single world-space fragment shader composites up to 13 resident volumes, each with its own `world_to_voxel`. A 1 mm T1, an oblique 0.4 mm T2 and a label volume therefore line up by affine, with no resampling (`core/render_loop/shaders/slice_world_space_optimized_masked.wgsl:36-75`, `core/render_loop/src/multi_texture_manager.rs:26`).

**Label layers are first-class:**

- nearest sampling of exact integer IDs;
- a 2048-wide LUT row per palette, with alpha as per-label visibility;
- live palette updates through `upsert_custom_colormap`;
- an outline pass for either one selected label or all boundaries, with a halo.

Sources: `core/render_loop/src/texture_manager.rs:17-20`, `core/render_loop/src/lib.rs:801-860`, and shader lines 95–106 and 242–300. Fill comes from the layer itself, and the outline for `selected_label_id` is composited on top. So "faint fill for every label, crisp outline for the active one" is already possible today.

**Other building blocks:**

- **Compare mode** gives N linked panels with per-panel layer visibility and a shared crosshair (`ui2/src/stores/comparisonStore.ts:26-98`).
- **The renderer accepts arbitrary planes** through `ViewPlane {origin_mm, u_mm, v_mm}` (`ui2/src/types/coordinates.ts:13-27`).
- **`core/api_bridge/src/cluster_labels.rs`** already registers hidden derived label volumes on an exact affine, with documented ownership and lock order.
- **`core/api_bridge/src/clusters.rs`** has 6/18/26-connected flood fill with supersession generations.
- **The async-ownership rules in `AGENTS.md`** are exactly what edits and AI previews need: capture workspace and request order, reject stale results, and reclaim provisional resources.

### What is missing, and where it would live

| Need | What exists today | Gap | Proposed home |
|---|---|---|---|
| Editable label storage | Immutable `DenseVolume3` (`core/volmath/src/lib.rs:615-780`); cluster-label lifecycle | No mutable store or session | New `core/segmentation` crate plus `core/api_bridge/src/segmentation.rs` and a `BridgeState` field (`core/api_bridge/src/lib.rs:1356`) |
| Incremental GPU update | Whole-volume `write_texture` from `Origin3d::ZERO` (`multi_texture_manager.rs:873-890`) | No sub-box upload. Re-upload is triggered only by a timepoint change (`core/api_bridge/src/lib.rs:8286-8290`) | `update_region` / `update_volume_region` next to `update_volume_3d_at` (`core/render_loop/src/lib.rs:3592`), plus a content-revision key |
| Undo | `undo: () => {}` (`ui2/src/stores/viewStateStore.ts:795-796`); OS predefined Edit items (`src-tauri/src/main.rs:562-564`) | No application history | Rust history in the session; custom menu IDs; `segmentationStore.ts` mirror |
| Pointer input | Left click = crosshair, right-drag = window/level, wheel = slices (`ui2/src/components/views/SliceViewCanvas.tsx:452-530`); mouse-only props (`ui2/src/components/views/SliceViewport.tsx:47-52`) | No tool arbitration, pointer, pen or coalesced events | Pointer layer in `packages/visualization/src/slice` |
| Navigation | `ViewType` is axial, sagittal or coronal only (`ui2/src/types/coordinates.ts:27`) | No slice zoom or pan; no native or oblique plane | `viewStateGeometry.ts`, `SliceNavigationService.ts`, `ViewPlaneService.ts` |
| Multi-contrast layout | Compare panels | One view type per workspace (`comparisonStore.ts:71`) | Per-panel planes in `ComparisonRenderService.buildPanelViewState` |
| Outlines | One outline layer per frame (shader `:95-106`, `:545`) | Cannot show echo, atlas and proposal outlines together | Extend `SliceFeatureUbo`, gated by `shader_contract_test` and `slice_outline_render_test` |
| Region tools | Flood fill (`clusters.rs:436-460`) | No grow, morphology, distance transform or interpolation | `core/segmentation/{grow,morph,interpolate}.rs` |
| Filters | `@compute` only validated (`core/render_loop/src/shaders.rs:236-245`) | No compute pipeline and no filters | Point operations in the fragment shader; `core/render_loop/src/compute/`; CPU derived volumes |
| Saving labels | Population NIfTI writer, which sets `qform_code 0` (`core/api_bridge/src/population_slice/export.rs:325-350`); temp-file-and-rename helper (`core/api_bridge/src/image_export.rs:136-170`) | No label writer and no label-table writer; the UI has no fs write permission (`src-tauri/capabilities/default.json`) | `core/api_bridge/src/segmentation/save.rs` |
| AI runtime | One-shot `analysis.json` sidecar (`core/api_bridge/src/analysis.rs:472-520`); no ML crates in `Cargo.lock` | No session runner and no push events | `runner.type = "session"`; a new `app.emit` channel |
| GPU budget | 13 slots; auto-eviction of hidden layers | Proposals and filters compete for slots | Mark segmentation layers as essential (`AtlasPressureMonitor.ts`, `LayerEvictionService.ts`) |
| UI surface | Annotate stub behind a flag (`ui2/src/components/inspector/InspectorRouter.tsx:174-180`) | No editing UI | Segment inspector body plus a viewport tool rail |

### Product and design constraints

**There is no plugin path for an editor.** "Plugin" means three things in this codebase:

- the Tauri `api_bridge` command surface;
- a working but one-shot `analysis.json` sidecar: stdin is closed after one request, inputs are file paths only, and status is polled;
- an iframe SDK that `plugins/AGENTS.md` used to describe, which no code implemented (the file was corrected on 2026-10-31).

Menus are hard-coded in `src-tauri/src/main.rs:555-700`, and the command palette is a static array (`ui2/src/App.tsx:212-300`). None of these can host an interactive editor.

**Segmentation is not in the vision.** The vision is inspection-first and never mentions segmentation (`docs/vision.md:3-36`). Two of its rules do bear on this module, though: it asks for label and outline layers with "explicit capabilities", and it asks Brainflow to "preserve the reference result while previewing alternatives" (`docs/vision.md:50-54`, `:71-80`).

**The design language is enforced by lint** (`ui2/src/styles/theme.css`, `ui2/eslint.config.js`):

- achromatic chrome;
- muted amber only as a focus ring or the edge of a selected row;
- a green crosshair (`--bf-crosshair #5fe0a0`) with a dark halo;
- IBM Plex type, sentence case and 2px radii;
- only `ui2/src/components/ui/bf` primitives.

**Several docs were stale.** This research found five docs that contradicted the code. All five were corrected on branch `claude/fix-stale-docs` (commit `fadf7ff`):

- `core/CLAUDE.md` said 15 texture slots; the code allows 13;
- the render_loop docs claimed wgpu 0.25; `Cargo.toml:33-37` pins 0.20.1;
- `ui2/CLAUDE.md` claimed "time travel" undo, which is not implemented;
- `plugins/AGENTS.md` described iframe plugins that do not exist;
- `docs/architecture-agent-reference.md:52` described an amber primary and crosshair.

## Recommended design: a Segment mode built on six contracts

### The six contracts

The recommendation is a first-party Segment mode. Six contracts fix its behaviour, and each one answers a documented failure in ITK-SNAP or Slicer.

1. **Reference grid.** Each segmentation is bound at creation to one grid and affine. By default that is the active anatomical image; for subfields it is the native T2. It is never silently resampled, and other contrasts reslice to it for display.
2. **Safe edits.**
   - Labels within a layer are exclusive.
   - Any label can be locked.
   - Imported atlas labels and labels marked complete lock automatically.
   - Protection never depends on visibility.
   - The active constraints are always visible at the cursor, including the reason a stroke did nothing.
3. **Preview, then confirm.**
   - Interpolation, growing, filter-driven fills, post-processing and AI all produce a named proposal.
   - Each proposal shows the voxels it will change.
   - A button that names the target label commits it.
   - Undo inside a proposal is separate from document undo.
4. **Cursor equals fill.** The brush and contour previews use the same rasterization rule that writes the voxels. That rule works in world millimetres on the reference grid, so results never depend on zoom.
5. **View-only aids.** Filters and fused displays never write to images or labels. They are anchored in millimetres, and they carry a visible badge whose recipe is logged with each stroke.
6. **Provenance and history.**
   - Every voxel records how it got its label: manual, interpolated, grown, AI-accepted, AI-edited or imported.
   - History is sparse and capped by bytes rather than step count.
   - It survives slice changes, covers every operation, and is journalled to disk.

### Module shape: a first-party mode with pluggable AI providers

**How users reach it.** Because Brainflow cannot host third-party editors, the module should be first-party but feel like a plugin: off until wanted, and one gesture away. Entry points:

- an `Inspector | Segment` mode switch that replaces the `AnnotateBody` stub (`ui2/src/components/inspector/InspectorRouter.tsx:174-180`);
- command palette entries: "New segmentation on this image", "Edit labels in this layer", "Open label file…";
- the layer row's context menu.

It ships first behind the existing `experimentalFeatures` flag (`ui2/src/stores/featureFlagStore.ts:14-20`) and graduates after phase 1. Entering the mode changes the current view tab's layout in place to a Trace preset rather than opening a tool tab, because tool tabs have no slice layout (`docs/plans/qa-design-decisions-2026-10-30.md:5-30`).

**Where the code goes:**

- **`core/segmentation` (new, transport-neutral crate):** session, rasterizer, history, grow/morph/interpolate, and save. Keeping it transport-neutral leaves browser reuse possible.
- **`core/api_bridge/src/segmentation.rs`:** commands, single-sourced in `command_list.rs` with permissions per `core/api_bridge/ADDING_COMMANDS.md`.
- **`ui2/src/services/segmentation/`:** the UI service.
- **`ui2/src/stores/segmentationStore.ts`:** tool, brush, active label, constraints, and the `canUndo`/`canRedo` mirror. Label arrays stay in Rust.
- **`packages/visualization/src/slice`:** pointer input and overlays.

Do not feature-gate the bridge commands at compile time. That keeps the generated bindings and the permission checks aligned. The genuinely pluggable part is AI and batch presegmentation, delivered as providers under `plugins/segmentation/<provider>/` through an extended manifest.

### Data model: a reference-grid session with layers, locks and provenance

**`SegmentationSession`** holds:

- the reference grid: dimensions, affine and the source header;
- one or more label layers, each stored as u16 in copy-on-write bricks (for example 32³);
- a label table;
- a u8 provenance plane;
- a history;
- a revision counter.

**Layers work like MITK groups:** labels are exclusive within a layer and free to overlap across layers. Typical layers are whole hippocampus vs subfields, lesions vs anatomy, or rater A vs rater B.

**Each label table row carries:**

- index, name, abbreviation and colour;
- parent;
- a terminology code;
- lock state;
- status: not started, in progress, completed or flagged;
- maximum occurrences;
- protocol-pack ID.

**Lifecycle.** It copies `cluster_labels.rs`: a hidden registry volume, ownership passed to a displaying layer, release on unload, and the same lock order. The session publishes a read-only f32 view, so `compute_region_stats`, `region_locus` and population sampling consume traced labels immediately. That is a loop no rival offers: trace an ROI, then get regional statistics and population analysis in the same app.

**History:**

- It stores brick deltas tagged with operation name, tool, duration and display recipe.
- It is bounded by a byte budget plus a guaranteed minimum depth, as in ITK-SNAP.
- It is journalled to app-data every few strokes or seconds, and offers recovery on restart.

**Concurrency:**

- Every operation carries `(workspaceId, sessionId, baseRevision)`, and the backend rejects stale ones.
- Previews are superseded through a generation counter, as in `core/api_bridge/src/clusters.rs:378-430`.
- On failure, proposal volumes and GPU leases are released.

**Saving** goes in `segmentation/save.rs`, built from existing parts:

- the `nifti 0.17` writer, but preserving both qform and sform (unlike population export) with `intent_code` 1002, uint8 or uint16, and gzip;
- the temp-file-and-rename helper and the Rust save dialog.

It writes `dseg.tsv`, an ITK-SNAP label file and a FreeSurfer LUT alongside the volume. A JSON sidecar records protocol version, rater, software version, source-image hash and time on task. Provenance is exported as a separate `desc-provenance_dseg` volume.

**Importing:**

- ITK-SNAP, FreeSurfer and BIDS label tables. Move their parsing out of `ui2/src/services/LabelTableService.ts` into Rust, so the reader and the writer share code.
- `.mgz`, which ITK-SNAP lacks.
- `.seg.nrrd`, later, mapping its segment layer and value fields.

### Rendering: sub-box uploads, revision keys, multiple outlines and a compute tier

**Partial uploads.** Add `MultiTextureManager::update_region` and `RenderLoopService::update_volume_region(slot, origin, extent, bytes)`, plus a facade method. They use `queue.write_texture` with a non-zero `Origin3d`, which the pinned wgpu 0.20.1 supports. Gate them with a GPU test beside `display_upload_regression_test` that compares a partial upload against a full one and never soft-skips. Key render preparation on a content revision (`core/api_bridge/src/lib.rs:8224`).

**Labels and proposals.**

- Labels upload through the existing exact-ID R32Float path. IDs above the 2047 LUT cap need a display remap (`ui2/src/utils/labelTable.ts:24`).
- Proposals are a cropped label texture with its own affine, so each takes one slot. Mark them essential so eviction skips them.
- The working set — T1, T2, FLAIR, labels, a proposal and one derived filter — takes 6 of the 13 slots.

**Outlines.** Extend `SliceFeatureUbo` to at least two outline layers, each with its own style (solid or dashed), so the active-label echo, an atlas or second rater, and a proposal can be drawn together. In the same change, settle the pending "edge-voxel sampling convention" (`docs/plans/ui-redesign-phase3.md:155-161`).

**View geometry.**

- Implement zoom and pan by scaling `u_mm`/`v_mm` and shifting `origin_mm`, snapping to device pixels at integer zoom levels.
- Add a "native" view type whose basis comes from a volume's affine columns.
- Add a long-axis view built from two clicks.
- Store both as invertible view transforms, never as a resampled label volume, per the coordinate contract.

**Display.** Add per-layer gamma, sigmoid and curve LUTs; the existing `alpha_gamma` precedent makes this a small shader-contract change. Add a prefiltered-spline interpolation mode.

**Compute.**

- New `core/render_loop/src/compute/` module, with its own contract entries, for per-reslice filters and GrowCut.
- CPU Rust filters on `Frame` with rayon for derived volumes, registered as hidden layers.

**3D view.** Use marching cubes in Rust, registered through `SurfaceRegistry::insert_surface` (`core/api_bridge/src/lib.rs:1202`). Generate meshes lazily and at low priority, so they never block painting as Slicer's live 3D does.

**Latency.** The render path is declarative: the UI sends a `ViewState` and receives RGBA bytes. Nobody has measured how long that round trip takes during painting. A stroke should therefore use wet ink:

1. During the stroke, draw the exact footprint on an overlay canvas, using coalesced pointer samples.
2. Send the stroke polyline to Rust on pointer-up, or every ~50 ms during long strokes.
3. Rust rasterizes, records deltas, uploads the dirty sub-box and bumps the revision.
4. The overlay clears when the re-render lands.

### Workflow and interface: Trace layout, visible constraints, one keymap grammar

**The Trace layout:**

- one large primary panel in the tracing plane (by default, the T2 acquisition plane);
- two smaller orthogonal panels;
- a strip of linked secondary-contrast panels. This extends Compare with per-panel view planes.

All panels share crosshair, plane, zoom and pan, and the active label's outline echoes in every panel. A hold key flickers the primary panel's contrast, or raw vs filtered. A modifier summons the lens, and the edge overlay is a toggle.

**The viewport header** (`ViewportFrame`) carries a constraint strip in Plex Mono, for example "CA1 · over unlocked · range T1 40–120 · 2D · 1.2 mm", plus a filter badge. A stroke the constraints block briefly shows the reason.

**The label list** in the Segment inspector has one `SelectableRow` per label, showing swatch, ID, name, voxel count and mm³, eye, lock and status pill. Around it sit:

- search;
- hover highlighting;
- Reveal;
- a hold-key eyedropper;
- bulk merge, relabel and split-islands;
- parent/child collapse;
- vocabularies from protocol packs.

There are no modal label dialogs, unlike ITK-SNAP's separate Layer Inspector and Label Editor. Design.md's "one editable home per control" applies.

**The keymap** is one grammar with three presets:

- Brainflow (the default);
- ITK-SNAP: 1–5 for tools, `<`/`>` for labels, A/D/S for opacity, Ctrl+V to paste a polygon;
- Slicer: `q`/`w` for segments, Space for the last effect.

It is user-remappable on top of `KeyboardShortcutService` registrations (`ui2/src/services/KeyboardShortcutService.ts:14-29`). Scoping by `when()` and priority to Segment mode avoids collisions with the existing single-letter keys `g`, `o`, `c`, `a`, `p`, `t`, `i`, `k`, `L` and the digits. ⌘Z/⇧⌘Z become custom menu IDs that replace `PredefinedMenuItem::undo/redo` and defer to text fields when one has focus.

**Other panels.** A history panel and per-label statistics become bottom-dock tabs (`ui2/src/components/layout/bottomWorkbenchDock.constants.ts:21-26`).

**Review mode** offers:

- a read-only display with outlines only;
- rater A solid and rater B dashed;
- a disagreement map;
- next-disagreement and next-flag navigation;
- approve and return;
- comments anchored in world space.

**Protocol packs** are versioned JSON. Each pack holds:

- the label table, with vocabulary and maximum occurrences;
- the tracing plane and contrast recipe;
- ordered steps, with rule text and example thumbnails;
- landmark definitions that become shaded slabs in the orthogonal views (HarP rostral and caudal limits; HSG head, body and tail);
- the labels allowed in each slab, so a body slab offers subfield labels and a tail slab offers only the whole-structure label.

Outputs record the pack version. A practice-against-reference mode reuses the QC metrics to give HarP-style point-by-point feedback.

**Aesthetic:**

- Chrome is achromatic. Colour appears only in images, label swatches and semantic status.
- The brush cursor is a neutral white ring with a dark halo, matching the crosshair's style but distinct from the green crosshair and from green labels.
- The crosshair hides or opens a gap while drawing.
- Proposals appear in the target label's own colour as a dashed outline with hatched fill and a "Proposal" `StatusPill`, not in a new hue.
- Amber marks only the focus ring and the edge of the selected row.
- Every control comes from `components/ui/bf`, so the ESLint ratchet passes.

### Tool set

| Tool | Interaction | Rule or algorithm | Runs in | Phase |
|---|---|---|---|---|
| Brush and eraser | Drag; `[`/`]` or Shift+wheel for size; Ctrl or right button inverts; 2D disc or 3D sphere | Voxel centre inside the brush, measured in mm on the reference grid; voxel-exact mode | Rust rasterizer plus wet-ink overlay | 1 |
| Polygon and freehand contour | Click or drag; Return accepts; editable vertices; paste last polygon | Voxel centre inside, or a >50% coverage rule for lesion protocols | Rust | 1 |
| Fill, holes, islands | Click | Generalized `clusters.rs` flood fill (6/18/26), 2D or 3D, connected only | Rust | 1 |
| Constraint gate | Constraint strip | Paint-over policy, locks, editable region, intensity range on any loaded contrast | Rust, shared by every tool | 1 |
| Fill between slices | Keyframes in any orientation; ghost preview; apply per gap or all | Morphological contour interpolation; fast SDF/JFA preview | Rust CPU; WGSL preview | 1–2 |
| Post-processing | Preview with voxel delta | Margin in mm via distance transform; median, open, close; joint smoothing; smoothing brush | Rust | 2 |
| Threshold and adaptive brushes | Drag; wheel adjusts tolerance | Dynamic threshold seeded at the click; brush-bounded flood fill with tolerance | Rust, later WGSL | 3 |
| Livewire | Anchor clicks along edges | 2D shortest path on gradient cost | Rust CPU | 3 |
| Grow from seeds | Seeds in two or more labels, including background; auto-update | Multi-label GrowCut on an ROI | WGSL compute | 3 |
| Multi-contrast classifier | Paint examples | Random forest over T1/T2/FLAIR plus neighbourhood features, giving a probability map that feeds grow or threshold | Rust CPU | 3 |
| AI prompts | Point, scribble, box, lasso, each positive or negative | nnInteractive via the provider; proposals only | Sidecar | 4 |

### AI integration: providers, proposals and a licence gate

**The provider protocol** (`InteractiveSegProvider`) has five steps:

1. Open a session: the volume by path or raw bytes, its affine, and an ROI crop on the reference grid.
2. Send prompts: point, scribble, box or lasso, each positive or negative.
3. Receive a cropped mask plus its offset.
4. Reset.
5. Close.

Results reach the UI through a new `app.emit` channel, because analysis is polled today.

**The first provider** is an HTTP client for `nninteractive-server`:

- It points at 127.0.0.1 by default, run via Docker or pip.
- A remote URL plus API key covers macOS and CPU-only machines.
- Non-local URLs trigger a warning.
- It never calls a third-party hosted API by default.

For locally launched providers, `analysis.json` gains `runner.type = "session"`. This reuses discovery and the `kill_on_drop` lifecycle (`core/api_bridge/src/analysis.rs:120-154`, `:472-500`).

**Gesture mapping:**

- click → point;
- drag → scribble;
- closed polygon → lasso, the best refinement prompt;
- Alt or right button → negative.

A channel selector chooses which contrast is sent, because the model takes one channel. Cropping around the target cuts transfer time and latency.

**Results are always proposals:**

- Every result lands as a proposal layer, never directly in the labels.
- Confirm names the target label.
- A proposal never overwrites locked labels or other objects, which avoids the ITK-SNAP #217 failure.
- Refining an existing label is opt-in.
- Changing the active label never silently resets the proposal's target.

**Licence gate:**

- Show `session.license` on first use and require acknowledgement.
- Record the model and licence in the provenance sidecar.
- Never bundle or auto-download nnInteractive or MedSAM2 weights.

**Batch presegmentation** uses the existing one-shot sidecar once inputs are saved to files; `ui2/src/modules/analysis/services/AnalysisService.ts` (`openArtifact`) already loads volume results. Results load as proposals for correction. A candidate is NV-Segment-CTMR, for non-commercial use.

**Later options:**

- Add in-process `ort` with Apache-2.0 SAM 2.1-tiny ONNX for 2D slice prompting, testing the CoreML and DirectML execution providers.
- Skip SAM-Med3D, SegVol and VISTA3D for brain MRI.
- Revisit SAM 3 after a licence review.
- Watch the LLM-agent pattern now in SlicerNNInteractive, where a typed request becomes prompts. It shows a data-sharing notice, because renderings go to the LLM provider ([SlicerNNInteractive README](https://github.com/coendevente/SlicerNNInteractive/blob/main/README.md)). A clean command surface would let Brainflow adopt it later, but it should not shape v1.

### Phased roadmap

| Phase | Ships | Main code | Exit evidence |
|---|---|---|---|
| 0. Editing foundations | Session on a chosen grid; stroke, fill and erase commands; sub-box upload; revision invalidation; brick undo; autosave journal; zoom and pan; pointer tool arbitration with coalesced events; label NIfTI and table writers | `core/segmentation`, `core/api_bridge/src/segmentation.rs`, `multi_texture_manager.rs`, `SliceViewCanvas.tsx`, `packages/visualization/src/slice` | Known-answer rasterization on synthetic oblique and anisotropic grids; byte-equal undo/redo; NIfTI round trip (affine, intent 1002, dtype); partial-vs-full GPU upload test that never soft-skips |
| 1. Manual parity-plus | Brush, contour and fill; label manager with locks, status, search, eyedropper and bulk ops; constraint strip; keymap presets; history panel; label import/export; interpolation with ghost preview | `ui2/src/services/segmentation`, `segmentationStore.ts`, `InspectorRouter.tsx`, `LabelLegendSection.tsx` | Harness scenarios and screenshot baselines; native app check of pen, trackpad, ⌘Z and save dialog; pilot timing against ITK-SNAP 4.4/4.6 |
| 2. Multi-contrast tracing | Trace layout with per-panel planes; contour echo; flicker; lens; native and long-axis planes; voxel grid; display interpolation modes; contrast curves saved per modality; post-processing; lazy 3D mesh | `comparisonStore.ts`, `ComparisonRenderService.ts`, `coordinates.ts`, shader and `shader_contract.rs` | `shader_contract_test`, `slice_outline_render_test` and goldens; fidelity check of outlines against voxel edges |
| 3. Semi-automatic and filters | Compute module; per-reslice filters; derived-volume jobs; threshold and adaptive brushes; GrowCut; livewire; multi-contrast classifier | `core/render_loop/src/compute/`, `core/segmentation/{grow,filters}` | Known-answer growth tests; measured latency on 256³ and 0.5 mm whole-brain volumes |
| 4. AI provider | Session runner; nnInteractive client; proposals; licence gate; crop transfer; batch presegmentation | `core/api_bridge/src/analysis.rs`, `core/bridge_types`, `plugins/segmentation/` | Mock-server tests; stale-response rejection; latency per GPU class |
| 5. Protocol and QC | Protocol packs and landmark slabs; review mode; Dice, HD95, ICC and STAPLE; BIDS derivative bundle with provenance; `.seg.nrrd`, then DICOM SEG; opt-in time telemetry | `core/segmentation/qc`, Segment inspector | Known-answer metric tests; internal timed hippocampus/amygdala study with NASA-TLX |

**Why this order:**

- **Phases 0 and 1** deliver the safety contracts and the first useful product: a traced ROI that feeds Brainflow's own region statistics and population sampling. Tracers used to ITK-SNAP can switch at that point.
- **Phase 2** is the largest visible advantage over ITK-SNAP, and it mostly reuses the existing renderer.
- **AI comes fourth** for three reasons. It is parity rather than an advantage, since every rival already ships nnInteractive. Its licence complicates distribution. And it needs the proposal contract from phase 1. Once proposals exist it can be pulled forward, because the provider is mostly sidecar plumbing.
- **Protocol packs come last** because they depend on everything else, but they are the strongest long-run advantage.

### Open risks and decisions

**Product decisions.**

- **Vision fit.** The owner must decide whether segmentation belongs in Brainflow at all. The best framing is ROI definition with provenance, feeding region statistics and population analysis, rather than a general annotation suite.
- **Licensing.**
  - nnInteractive weights are CC BY-NC-SA, MedSAM2 weights are research-only, and SAM 3 has a custom licence.
  - How these interact with Brainflow's own licence was not reviewed.
  - A user-supplied-weights policy with a recorded licence is the safe default.
- **Evidence.** No AI model and no contrast filter has published validation on hippocampus, amygdala or thalamus. Brainflow should not claim speed-ups until its own timed study exists. That study should follow the schwannoma design: the same tasks in ITK-SNAP and Brainflow, with time and NASA-TLX workload.

**Engineering risks.**

- **Paint latency.** The render, readback and canvas round trip is unmeasured. Wet ink hides it, but it must be measured on real volumes.
- **Pen pressure.** It needs native code on macOS and Linux. Decide whether pressure is in scope at all; precision without pressure is the safe v1.
- **Rendering limits.**
  - The 13-slot budget and single outline layer need the changes above.
  - wgpu is pinned at 0.20.1, so features such as `FLOAT32_FILTERABLE` and the compute pipeline must be checked against that version. Upgrading is a separate decision.
- **Label IDs.** IDs above 2047 need remapping for display.
- **One rasterizer.** The footprint preview and the voxel writer must share one rule. That means either cheap IPC queries for small brushes, or compiling `core/segmentation` to WASM. The WASM route would also restore browser parity, since label editing is unavailable in the browser today (`docs/browser-viewer.md:160-167`).
- **Overlap model.** Choose between layers in the Slicer style and groups in the MITK style. This report recommends groups implemented as layers.

**Competitive risk.** ITK-SNAP 4.6 already adds SAM2, autosave and remote data, and it is prototyping a JavaScript UI. Brainflow's advantage must rest on the structural points it cannot quickly copy: safe edits, multi-grid oblique rendering, and workflow and provenance. A newer look alone will not hold.

## Conclusion

ITK-SNAP's limits come from two old architectural choices: the main image's grid is king, and editing runs on global modal state. Brainflow's renderer happens to be the opposite: it is world-space, works across grids, and resolves each layer through its own affine. The hardest problem for ITK-SNAP — oblique, multi-contrast tracing on native anisotropic grids — is therefore mostly UI and data-model work for Brainflow, not a rendering rewrite. Meanwhile, AI is becoming a commodity. nnInteractive now ships in ITK-SNAP, Slicer, MITK, napari and OHIF, so adding it creates parity, not an advantage. The lasting advantage is trust: edits that cannot silently destroy work, proposals that cannot overwrite, and a record of how every voxel got its label.

The module also changes what Brainflow is for, without abandoning its vision. A traced, provenance-tagged ROI that flows straight into regional statistics and population sampling turns "inspect a brain summary" into "define, measure and compare in one place". The field's evidence vacuum is an opening as much as a risk. No one has published AI or filter accuracy on hippocampus or amygdala, or split tracing time into navigation, drawing and correction. Brainflow's local telemetry, plus a small timed study against ITK-SNAP, could produce that evidence first, making the module a scientific contribution as well as a feature.
