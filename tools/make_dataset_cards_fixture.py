"""Synthetic multi-analysis dataset fixture for looking at dataset cards."""

import json
import os
import shutil
import sys

root, src = sys.argv[1], sys.argv[2]
if os.path.exists(root):
    sys.exit(f"{root} already exists")

analyses = {
    "glm_recog": dict(
        Name="Recognition GLM",
        BIDSVersion="1.8.0",
        DatasetType="derivative",
        GeneratedBy=[
            dict(
                Name="fmrireg",
                Version="0.4.2",
                CodeURL="https://github.com/example/fmrireg",
                Container=dict(Type="apptainer", Tag="fmrireg:0.4.2"),
            )
        ],
        SourceDatasets=[
            dict(URL="../../rawdata", Version="1.0"),
            dict(DOI="doi:10.18112/openneuro.ds000001.v1.0.0"),
        ],
        Authors=["A. Researcher", "B. Colleague", "C. Student"],
        License="CC0",
        Acknowledgements="Synthetic fixture for UI checks.",
        Funding=["Grant 123", "Grant 456"],
        HowToAcknowledge="Cite the fixture.",
        ReferencesAndLinks=["https://example.org/paper"],
        CustomLabField={"nested": [1, 2, 3]},
        PipelineNote="first-level, 6mm smoothing",
    ),
    "glm_encoding": dict(
        Name="Encoding GLM with a deliberately long title to test wrapping in the card header",
        BIDSVersion="1.8.0",
        DatasetType="derivative",
        GeneratedBy=[dict(Name="fmrireg", Version="0.4.2")],
    ),
    "rsa_searchlight": dict(
        Name="RSA searchlight",
        DatasetType="derivative",
        GeneratedBy=[
            dict(
                Name="rMVPA",
                Version="0.9.0",
                Description="Searchlight RSA, radius 8 mm",
            )
        ],
    ),
}

readme = """# Recognition GLM

First-level models for the **recognition** phase. See [the docs](https://example.org/docs) and `enc_rep/maps`.

## Contents

- `same_item`: repeated item contrast
- `diff_item`: novel item contrast
  - nested bullet
1. ordered one
2. ordered two

> Block quote with *emphasis*.

| Contrast | Meaning |
| --- | --- |
| same_item | repeat > baseline |

```
fmrireg fit --model recog
```

<script>alert('x')</script> <b>raw html</b> ![figure](fig.png)

[bad link](javascript:alert(1))
"""


def dump(obj, path):
    with open(path, "w") as fh:
        json.dump(obj, fh, indent=2)


for name, dd in analyses.items():
    a = os.path.join(root, "derivatives", name)
    os.makedirs(a)
    dump(dd, os.path.join(a, "dataset_description.json"))
    if name == "glm_recog":
        with open(os.path.join(a, "README.md"), "w") as fh:
            fh.write(readme)
        dump(
            dict(TaskName="recog", RepetitionTime=2.0, Level="dataset"),
            os.path.join(a, "task-recog_stat.json"),
        )
    elif name == "glm_encoding":
        with open(os.path.join(a, "README"), "w") as fh:
            fh.write("Plain text readme without extension.\n\nSecond paragraph.\n")
    nsub = 12 if name == "glm_recog" else 4
    for s in range(1, nsub + 1):
        sub = f"sub-{s:02d}"
        for kind in ("same_item", "diff_item"):
            d = os.path.join(a, sub, "enc_rep", "maps")
            os.makedirs(d, exist_ok=True)
            stem = f"{sub}_task-recog_desc-{kind}_stat"
            shutil.copy(src, os.path.join(d, stem + ".nii.gz"))
            if s <= 2:
                dump(
                    dict(
                        Contrast=kind,
                        Smoothing_mm=6,
                        Units="z",
                        Sources=[f"bids:raw:{sub}/func/{sub}_task-recog_bold.nii.gz"],
                        Level="file",
                    ),
                    os.path.join(d, stem + ".json"),
                )
        if s == 1:
            dump(
                dict(SubjectNote="left-handed", Level="subject"),
                os.path.join(a, sub, f"{sub}_task-recog_stat.json"),
            )

os.makedirs(os.path.join(root, "plain_folder", "inner"))
shutil.copy(src, os.path.join(root, "plain_folder", "inner", "scan.nii.gz"))
with open(os.path.join(root, "derivatives", "README.md"), "w") as fh:
    fh.write("# Derivatives\n\nThree analyses of the pcmri fixture.\n")
