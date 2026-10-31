# Segmentation design reference (direction H, round 7)

The final captures of the segmentation design hill climb (October 2026):
16 states at 1440 × 900 and three at 1280 × 800, rendered from the design
components in `ui2/src/modules/segmentation/components/` through
`ui2/segmentation-harness.html?direction=h&state=<state>`. They are the
target for the implementation (`docs/plans/segmentation-implementation.md`)
and the baseline for the design-parity capture (see
`ui2/src/modules/segmentation/AGENTS.md`). The design itself, its rules and
its decisions are in `ui2/src/modules/segmentation/DESIGN.md`; the critics'
verdicts and open checks in [../critiques.md](../critiques.md).
`manifest.json` is the capture manifest (per state: description, decisions,
what is mocked; round 7's changes by critic issue).

## What is real and what is mocked

- **Real:** the MNI152NLin2009cAsym 1 mm T2w and T1w template slices
  (TemplateFlow); the rules the screens follow (the brush footprint, the
  constraint gate, partition strokes, review encoding, the proposal gate,
  over-reach, the range brush and partial-volume rule, 26-connected lesions,
  label-volume header and table writers), which are pure functions under
  test.
- **Mocked in every state:** subfield labels (from a HOSPA dseg), strokes,
  proposals, rater B, every count, time and file name; the native
  0.40 × 0.40 / 2.0 mm oblique T2 geometry (the imagery stays 1 mm; native
  slices are every second template slice); editing (no bridge, no Rust).
- **Session facts** (journal steps, provenance codes, ruler and matrix
  marks) come from one mock session model, `shared/session.ts`.

## States

Core states (rounds 0–4):

| File | State | What it shows | Also mocked |
| --- | --- | --- | --- |
| `empty.png` | Empty | T2w and T1w loaded, the start card (reference grid, label table, "New segmentation on T2w"). | — |
| `tracing.png` | Tracing | Brush mid-stroke on the oblique coronal T2w with its exact footprint, constraint strip, step card, labels, slice matrix, orthogonal reslices. | the stroke |
| `tracing@1280x800.png` | Tracing at 1280 × 800 | The narrow layout (220 px orthogonals, 304 px Inspector). | as tracing |
| `multi-contrast.png` | Multi-contrast | Tracing plus the contrast strip: T1w, a view-only unsharp T2w and the pack example at the primary's slice and scale. | the pack example (template labels) |
| `multi-contrast@1280x800.png` | Multi-contrast at 1280 × 800 | The narrow layout of the same. | as multi-contrast |
| `blocked.png` | Blocked | A CA1 stroke refused over locked DG: hatched warning footprint, one card at the cursor, a Blocked chip. | the stroke |
| `proposal.png` | Proposal | Fill between slices: CA1 hatch with a thin outline, crossed skipped voxels, accepted slice by slice. | the interpolation |
| `review.png` | Review | Read only: rater A once, rater B where it departs (dash), disagreement textures, flagged regions with Keep A / Take B / Edit, Return and Approve. | rater B |
| `zoom.png` | Zoom | 6× with the voxel grid and the brush size popover. | — |

Workflow states (rounds 5–7, direction H only):

| File | State | What it shows | Also mocked |
| --- | --- | --- | --- |
| `ai-prompt.png` | AI assist | nnInteractive prompts on the slice; the 3D answer (k 5–13) as a CA1 proposal accepted slice by slice; a two-line bar; over-reach checked on the slice and the ruler; the proposed slab in the axial view. The session at step 31. | the model's answer, the server, latency |
| `ai-consent.png` | AI licence gate | First use: server, model weights licence, what AI does, what is recorded (record behind "Show record"); no AI marks before first use. | server status, version, URL |
| `lesion.png` | White-matter lesions | Range brush with the > 50% partial-volume rule on a FLAIR, outline-only lesions, T1w and T2w at the primary's scale while L1's type is set, seed rows, span and mm³ bars, Fazekas (provisional). | the FLAIR (made from the T1w template) and its six synthetic lesions; the LST-AI seed |
| `lesion@1280x800.png` | Lesions at 1280 × 800 | The narrow layout of the same. | as lesion |
| `lesion-overview.png` | Lesions at fit | The whole axial slice with every lesion tag, coronal and sagittal cuts with the axial band. | as lesion |
| `contrast-aids.png` | Contrast aids | A view-only unsharp filter with its badge, the square T1w lens at the brush, View aids in one line; "Saved 14:33" after a quiet ⌘S. | the filter (the generator's unsharp mask) |
| `history.png` | History | The bottom dock: steps with signed voxel bars, the kept branch with Restore, undo per label, the journal; one step count. | steps, times, voxel sets |
| `save.png` | Save as / export | The sheet: draft warning, label volume, dseg.tsv, provenance, BIDS destination and the four files. | paths, hashes, times |
| `resume.png` | Resume | After a crash: the recovery banner, the view restored, the last edit outlined. | the crash and the journal |
| `setup.png` | Session setup | The new-session sheet; the primary is the registration check (T1w in 8 mm squares over T2w at tracing zoom); the slab locator. | the pack, palette and new label; the two templates register perfectly |

## Regenerating

Do not edit these files by hand. They change only when the design changes:
re-render with the capture spec (`e2e/playwright.segmentation-design.config.ts`,
`SEG_DESIGN_ROUND=<round>`), review every image, then copy the PNGs and the
manifest here in the same commit as the design change, and say why in
`DESIGN.md`. The parity mode (`SEG_DESIGN_PARITY=1`) compares a fresh
render against this folder.
