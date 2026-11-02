# BIDS browser mockups

These are the design mockups behind [bids-browser-design.md](../bids-browser-design.md).
Round 3 (`src/r3.html`) is the approved design. Rounds 1 and 2 are kept to show
how the decisions were reached.

The pages are standalone HTML drawn with the live `--bf-*` token values and IBM
Plex. They are a visual and behavioural spec, not code to port. The app should
rebuild these views as React components on the real store and primitives.

## Contents

| Path | What it is |
| --- | --- |
| `screenshots/r3-*.png` | The approved round 3 states: coverage with a lens, images, ⌘K with Files sync, exclude and undo, 400 participants while scanning |
| `src/data.js` | The synthetic example dataset and the single derived model (`M`, `QC3`, `runQC`). Every count on screen comes from here. |
| `src/r1.html` | Round 1: three directions (Matrix, Dossier, Query) |
| `src/r2.html` | Round 2: the first converged design |
| `src/r3.html` | Round 3: the approved design and its states |
| `src/base.css` | Shared shell styles; the tokens are copied from `ui2/src/styles/theme.css` |
| `tools/make_assets.py` | Renders brain thumbnails from the MNI template (numpy and Pillow; nibabel is not needed) |
| `tools/build.py` | Inlines CSS, data and thumbnails into one page per round |
| `tools/shot.cjs` | Full-page screenshots with the preinstalled Playwright Chromium |

## Build

From the repository root:

```sh
mkdir -p cruft/bids-design
python3 -I docs/plans/bids-browser-mockups/tools/make_assets.py \
  test-data/unit/tpl-MNI152NLin2009cAsym_res-01_desc-brain_T1w.nii \
  cruft/bids-design/assets.json
python3 -I docs/plans/bids-browser-mockups/tools/build.py r3
node docs/plans/bids-browser-mockups/tools/shot.cjs cruft/bids-design/r3.html \
  cruft/bids-design/r3 state-coverage,state-images,state-palette,state-exclude,state-scale
```

Open `cruft/bids-design/r3.html` in a browser. The tabs switch between states:

- `#state-coverage`
- `#state-images`
- `#state-palette`
- `#state-exclude`
- `#state-scale`

Generated files (`assets.json`, the built pages and screenshots) go to the
git-ignored `cruft/`. They are not committed: the built pages are about 450 KB
each, because the thumbnails are inlined.

## What is synthetic

- Every participant, demographic, QC value, issue and variant in `data.js` is
  invented to exercise every state. Nothing is real participant data.
- The brain images are slices of the MNI152NLin2009cAsym template. The EPI
  look, the frontal signal dropout, the ghosting and the carpet plot are
  synthetic.
- The 400-participant view uses a separate random generator. Only its layout
  matters.

## Mapping to the implementation

| Mockup | Implementation target |
| --- | --- |
| `M`, `QC3`, `runQC`, `sesMeanFD` in `data.js` | One derived model in `ui2/src/stores/bidsStore.ts`, built from the bridge payload. Views select from it and never total their own counts. |
| `summary()` | Summary component. Its claims set the lens, and the FD threshold is edited inline. |
| `coverage()` and `legend()` | Rewrite of `ui2/src/components/bids/BidsCoverageMatrix.tsx` with one column per run. The cell marks are listed in the design doc. |
| `renderImages()` | New contact-sheet view, with slices requested on demand and cached |
| `findingsPanel()` | Findings panel in the left GoldenLayout stack beside Files |
| `filesPanel()` | The existing `ui2/src/components/panels/files/BidsView.tsx`, revealing the selected run |
| `inspector()` | `ui2/src/components/inspector/bids/BidsInspector.tsx`, run detail |
| `dockRuns()` | Bottom dock (`BottomWorkbenchDock`) tab listing the runs in the lens |
| `renderPalette()` | ⌘K entries for runs, participants, findings and saved lenses |
| `renderExclude()` | Exclusion dialog, plus a writer command limited to `derivatives/brainflow/` |
| `renderScale()` | The compressed-row matrix and the streaming-scan states |
