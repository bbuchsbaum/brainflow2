# Deep-structure view: design renders

Offline renders behind the deep-structure hill climb
([critiques](../../../docs/design/deep-structures/critiques.md)). They draw
the design from real public data with a small software rasteriser. They are
design evidence only: nothing here uses Brainflow's WGPU or three.js
renderers, and nothing here ships.

| File | What it does |
| --- | --- |
| `bfr.py` | Loading, sampling, the colour map, a z-buffer rasteriser with clip planes and cut faces. |
| `render.py <out> hipp\|thal` | Renders every panel of one state and writes `meta.json`. |
| `screens.py <out>` | Builds `h.html` for that state from the panels and `meta.json`. |
| `shell.py` | Static mock of the app shell, modelled on the Integrated layout. |
| `shot.js <html> <png>` | Captures a screen at 1440 x 900 with Playwright. |

## Inputs

Set `BF_DEEP_DATA` to a folder holding these public files, and
`BF_DEEP_FONTS` to a folder holding the IBM Plex Sans (400, 400 italic, 500,
600) and Mono (400, 500) latin woff2 files from `@fontsource`.

- TemplateFlow `tpl-MNI152NLin6Asym`: `res-01_T1w`, `res-01_desc-brain_mask`,
  `res-01_atlas-HOSPA_desc-th25_dseg`.
- TemplateFlow `tpl-fsLR`: `den-32k_hemi-{L,R}_midthickness.surf.gii` and
  `hemi-{L,R}_den-32k_desc-nomedialwall_dparc.label.gii`.
- `khanlab/hippunfold-templateflow`, `tpl-MNI152NLin6Asym`: `hemi-{L,R}`
  `den-1mm` `label-hipp_{inner,midthickness,outer}.surf.gii`, and the root
  `hemi-{L,R}_den-1mm_label-hipp_subfields.label.gii`.
- `khanlab/hippunfold`:
  `resources/unfold_template_hipp/tpl-avg_space-unfold_den-1mm_midthickness.surf.gii`.
- NeuroVault collection 457: `tfMRI_WM_2BK-0BK_zstat1.nii.gz` (HCP group map).

Python needs `numpy`, `scipy`, `nibabel`, `scikit-image` and `Pillow`.

## Run

```sh
python3 tools/design/deep_structures/render.py /tmp/deep/hipp hipp
python3 tools/design/deep_structures/screens.py /tmp/deep/hipp
node tools/design/deep_structures/shot.js /tmp/deep/hipp/h.html main.png
```
