# Design hill climb kit

The loop that designed the segmentation module (October 2026, rounds 0–7).
A builder renders every state of a feature. Three critics with fixed
lenses score the screenshots and list ranked issues. The builder fixes the
static ones, and the loop repeats until the critics say static rounds have
stopped paying. Use it again on screenshots of the real app as screens
are implemented. The results of the segmentation run are in
`docs/design/segmentation/critiques.md`.

## Files

| File | What it is |
| --- | --- |
| `prompts/_critic-common.md` | Shared critic instructions: inputs, method, scoring, output format. Put it in front of each critic prompt. |
| `prompts/tufte.md` | Data-ink and encoding critic: rubric and lessons. |
| `prompts/jobs.md` | Focus and simplicity critic: rubric and lessons. |
| `prompts/operator.md` | Expert-rater critic: rubric, lessons and prototype test priorities. |
| `prompts/builder.md` | Template for the agent that makes each round's changes. |
| `critique.schema.json` | JSON Schema for each critic's `<critic>.json`. |

## Rubrics at a glance

Every criterion is scored 0–10, and half points are allowed. `overall` is
the critic's judgement, not the mean. 8 means "ship with small fixes" and
9 means "nothing important left".

| Critic | Criteria (JSON keys) |
| --- | --- |
| Tufte | `data_ink_image_primacy`, `label_contour_encoding`, `comparison_design`, `typography_chrome_hierarchy`, `integrity` |
| Jobs | `focus`, `simplicity`, `defaults_flow`, `craft`, `delight` |
| Operator | `tracing_efficiency`, `safety_trust`, `multi_contrast_geometry`, `protocol_review`, `fatigue` |

Each issue is tagged by what it needs: `static` (fixable and checkable on
screenshots), `interactive` (needs a prototype in use) or `real-data`
(needs real images). Only `static` issues go to the next builder round. The
others become the prototype checklist.

## Folder layout

```text
cruft/hillclimb/<feature>/             # ignored by git: working captures
  round-<N>/
    <direction>/                       # a, b, c in round 0; the chosen direction after
      <state>.png                      # 1440 x 900
      <state>@1280x800.png             # narrow variants
      manifest.json                    # states, decisions, mocked, changes, conflicts, not_done
    critiques/
      tufte.md  tufte.json
      jobs.md   jobs.json
      operator.md operator.json
docs/design/<feature>/                 # committed when the loop ends
  reference/                           # final PNGs + manifest + README index
  critiques.md                         # score history, verdicts, open checks
```

## Capture

The segmentation capture spec renders the mock design harness
(`ui2/segmentation-harness.html?direction=<id>&state=<state>`):

```sh
cd e2e
SEG_DESIGN_ROUND=round-<N> SEG_DESIGN_DIRECTIONS=h \
SEG_DESIGN_BROWSER=/path/to/chrome-headless-shell \
  node_modules/.bin/playwright test -c playwright.segmentation-design.config.ts
```

`SEG_DESIGN_STATES` restricts the run. To compare with the committed
reference instead, set `SEG_DESIGN_PARITY=1` (see
`ui2/src/modules/segmentation/AGENTS.md`, "Design parity").

**On the real app.** Capture the same state ids at the same viewports
(1440 × 900, with 1280 × 800 variants), in dark mode, with motion reduced
and the fonts loaded. Use the app harness (`e2e/AGENTS.md`), with a
scenario per state fed by synthetic or approved fixtures. Write the files
into the same folder layout, with a manifest in the same shape, so the
critic prompts work unchanged.

## Running a round

1. **Build.** Fill in `prompts/builder.md` and run it (round 0: one builder
   per direction). The builder captures, reviews every PNG, writes the
   manifest and commits.
2. **Critique.** Run the three critics independently, in parallel, each
   with `_critic-common.md` plus its own prompt, `{{N}}` and the paths
   filled in. They only read screenshots and the manifest. They write
   `critiques/<critic>.{md,json}`.
3. **Check the JSON.** Validate it against the schema:
   `python3 -c "import json,jsonschema,sys; jsonschema.validate(json.load(open(sys.argv[1])), json.load(open('tools/design/hillclimb/critique.schema.json')))" cruft/hillclimb/<feature>/round-<N>/critiques/tufte.json`
4. **Decide.** Read the three critiques together. Record conflicts and
   decisions in the design doc, and add the scores to its score history.
5. **Stop** when every critic sets `more_static_rounds_useful: false`.
   Then do one targeted pass on the remaining static items, commit the
   final captures to `docs/design/<feature>/reference/`, and write
   `critiques.md`. Use the interactive and real-data issues, plus the
   operator's `prototype_test_priorities`, as the prototype checklist.

Round 0 asks for three different directions (for segmentation: a
workstation, a reading room and a protocol-guided flow). Round 1 builds a
hybrid of the best parts. Later rounds edit only the chosen direction.

## Data policy

Critics are models that receive screenshots. Use only synthetic data,
public templates (for example MNI152 from TemplateFlow) or fixtures the
owner has explicitly approved. Never capture participant images,
identifying file names or credentials (root `AGENTS.md`).
