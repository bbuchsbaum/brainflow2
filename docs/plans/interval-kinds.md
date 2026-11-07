# Interval kinds: one vocabulary for plotted bands

Status: in progress, 2026-11-07. Branch `feat/interval-kinds` (sparse worktree
`../brainflow2-intervals`). Motivated by the neuromosaic/neurotabs alignment
review; the shared vocabulary is expected to be defined in neurotabs (Q1).

## Problem

Brainflow draws dispersion bands from three code paths that use the same
words for different quantities:

| Name today | Set trace (`TraceBand`, Rust `roi_spread_band`) | Population recipe (`populationStage`) |
| --- | --- | --- |
| `ci95` | 2.5–97.5% sample quantiles (spread of the data) | mean ± t(.975, n−1)·SD/√n |
| `sem95` | mean ± 1.96·SD/√n | mean ± 1.96·SD/√n |
| `sd`, `iqr`, `none` | consistent | consistent |

Further defects:

- Rust `roi_spread_band` silently falls back to `sem95` for an unknown name.
- Labels are written separately in several places (`cartesianMarks.tsx`
  `BAND_NAMES`, `markLabels.ts`, `seriesRecipe.ts` `bandDescription`, three
  toolbars) and disagree: the set-trace toolbar calls `sem95` "95% CI (mean)".
- `seriesRecipe.ts` silently maps `iqr` to `ci95` under a mean summary.
- The recipe path always recomputes bands (`populationStage`), so bounds
  computed by another tool can't be drawn under their own definition.
- Summary rows carry no interval kind, level or df; the definition lives once
  on the frame (`meta.populationReduction.bandDefinition`).
- The recipe's `within: 'single' | 'mean'` means "how repeated rows are
  combined", not within-subject factors.

## Design principles

1. **One registry, everything derives from it.** Labels, formula text, UI
   options, validation and computation come from a single table of interval
   kinds. Adding a kind is one entry plus tests.
2. **Separate *what* an interval is from *who computed it*.** `kind` describes
   the quantity; `source` says whether brainflow computes it or reads stored
   bounds. A supplied t-CI is still `ci_t`, labelled the same way.
3. **Tolerant reader, strict writer.** Inputs from other tools go through one
   normalisation layer that accepts known spelling variants and reports
   anything it can't interpret. Brainflow writes only canonical names. Unknown
   kinds are errors, never silent fallbacks.
4. **Legacy names are translated by context, never globally.** `ci95` means
   quantiles in a set trace and the t-CI in a recipe; each source has its own
   alias table.
5. **No speculative machinery.** Plain data tables plus pure functions; the
   design declaration and the within-subject CI land only in phase 4.

## Model

```ts
// ui2/src/plotting/intervals/types.ts
type IntervalKind =
  | 'none'
  | 'sd'              // centre ± 1·SD
  | 'se'              // centre ± 1·SE (common in imported tables)
  | 'ci_normal'       // mean ± z(level)·SE           (today's sem95)
  | 'ci_t'            // mean ± t(level, n−1)·SE      (today's recipe ci95)
  | 'quantile_range'  // central `level` sample quantiles, type 7
                      //   (today's trace ci95 at 0.95; IQR at 0.5)
  | 'wsci_cm'         // Cousineau–Morey within-subject CI (phase 4)
  | 'custom';         // stored bounds whose definition isn't a known kind

interface IntervalSpec {
  kind: IntervalKind;
  level?: number;             // (0, 1); required for ci_*, quantile_range, wsci_cm
  source: 'compute' | 'columns';
  lower?: string;             // column names, required when source = 'columns'
  upper?: string;
  definition?: string;        // free text; required for 'custom'
}

const INTERVAL_COLUMNS = {
  kind: 'interval_kind', level: 'conf_level', df: 'df', n: 'n',
} as const;
```

- IQR is `quantile_range` at `level: 0.5`, still *labelled* "IQR".
- `level` is a field, not part of the name. The UI offers the conventional
  level per kind; other levels arrive via ingest.
- Column names are provisional until neurotabs fixes them (Q1), defined once.

### Registry entry

```ts
interface IntervalKindDef {
  kind: IntervalKind;
  centre: 'mean' | 'median' | 'any';
  needsLevel: boolean;
  defaultLevel?: number;
  shortLabel(level?: number): string;        // "95% CI (t)", "± SD", "IQR"
  definition(level?: number): string;        // "mean ± t(0.975, n − 1) · SD / √n"
  compute?(values, centre, level?): { lower; upper; df? } | null;
}
```

`wsci_cm` has no per-cell `compute` (it needs the design; phase 4); `custom`
has none and takes its label from `definition`.

## Modules (`ui2/src/plotting/intervals/`, no React or store imports)

| File | Responsibility |
| --- | --- |
| `types.ts` | `IntervalKind`, `IntervalSpec`, `INTERVAL_COLUMNS` |
| `registry.ts` | `INTERVAL_KINDS`; `intervalDef`, `intervalLabel`, `intervalDefinition`, `compatibleKinds` |
| `estimators.ts` | Pure estimators; reuses `tQuantile` / `sampleQuantile`, adds `normalQuantile` |
| `legacy.ts` | Per-context alias tables: `fromTraceBandV1`, `fromRecipeBandV1` |
| `ingest.ts` | Normalises external interval descriptions |
| `rows.ts` | Per-row interval columns; `frameIntervalSummary(frame)` |
| `index.ts` | Public surface |

### Ingest (tolerance for format variation)

`normalizeInterval(input, frame): { spec } | { error }` accepts:

- **Kind spellings:** canonical names, case/separator-insensitive, plus a small
  alias table (`t`, `sem`, `se`, `sd`, `iqr`, `quantile`, `percentile`,
  `cousineau_morey`, `morey`, …). Context-dependent legacy tokens (`ci95`) are
  not accepted here; they only come through `legacy.ts`.
- **Level:** `0.95`, `95`, `"95%"` → 0.95; a level embedded in the kind
  (`ci95_t`) is split off; a conflicting level is an error.
- **Bound columns:** if not named, detect from an ordered list of pairs
  (`lower/upper`, `ci_low/ci_high`, `conf.low/conf.high`, `lwr/upr`,
  `ymin/ymax`, `band_low/band_high`); several matches is an error.
- **Half-width form:** a `margin`/`half_width` column around the centre.
- **Per-row metadata:** `interval_kind`/`kind`, `interval_level`/`level`,
  `interval_df`/`df`, `n`/`count`.

## Phases

### Phase 0 — groundwork

- Confirm no other persisted or exported surface stores band names. Findings
  are recorded below.
- Proceed with the provisional names; they live in one file (Q1).

### Phase 1 — vocabulary and registry

1. `plotting/intervals/{types,registry,estimators,legacy,index}.ts` with unit
   tests:
   - the registry is total;
   - the estimators match hand-computed values and the existing
     `populationStage` / `roi_spread_band` numbers;
   - the legacy tables are total and `ci95` differs by context.
2. `populationStage` dispatches through the registry.
3. All label sites use `intervalLabel` / `intervalDefinition`; toolbars use
   `compatibleKinds`.
4. Remove the silent `iqr → ci95` mapping.
5. `TraceBand` becomes `IntervalKind`-based. `plotSpecStore` persist v4 migrates
   v3 `bandByMode` through `fromTraceBandV1`.
6. Rust `core/api_bridge/src/interval.rs`: `IntervalKind` enum plus
   `parse_trace_band` (canonical names plus legacy trace tokens).
   `roi_spread_band` takes the enum and the unknown-name fallback is removed.
   The command's `band: String` argument is unchanged, so bindings and
   permissions stay as they are.

### Phase 2 — recipe v2 and drawing stored bounds

1. `PopulationPlotRecipe` `version: 2`: `band: IntervalSpec`, `within` renamed
   to `repeatRows`. `upgradeRecipe` accepts v1/v2. `validatePlotRecipe` checks
   against the registry.
2. `source: 'columns'`: the bounds are copied, never recomputed.
3. Labels resolve from:
   1. the row's `interval_kind`;
   2. the frame's `meta.interval`;
   3. the recipe.

   Mixed kinds are labelled per row. A missing kind is labelled "interval
   (definition not supplied)".
4. `SuggestedSpec.band` gains an optional `interval`.

### Phase 3 — per-row metadata and ingest

1. Summary rows gain `interval_kind`, `interval_level`, `interval_df`, `n`.
2. CSV export adds the same columns (a user-visible change).
3. `ingest.ts` with table-driven tests and an export → ingest round trip.

### Phase 4 — design declaration and within-subject CI (separate PR)

1. `design?: { subject; within[]; between[] }`.
2. A `wsci_cm` estimator:
   - normalise per between-subjects group;
   - compute a t-CI on the normalised values times the Morey factor
     √(J/(J−1));
   - use complete cases only, with dropped subjects listed in provenance.
3. A golden test against neuromosaic on a shared synthetic fixture.

## Disk budget

The worktree is sparse. No second `node_modules` or Rust `target/`:

- **UI:** the worktree's `node_modules` are symlinks to the main checkout's
  installed ones.
- **Rust:** the sparse set is widened to the crate sources the workspace needs,
  and `CARGO_TARGET_DIR` points at the main checkout's `target/`.

## Open questions

- **Q1.** Does neurotabs own the kind list and column names? Adopt its
  spelling in `types.ts` / `INTERVAL_COLUMNS` when it does.
- **Q2.** Should the bridge command take a `level` argument (a command-surface
  change)? Deferred.
- **Q3.** Does the shared plot format live in neurotabs? Brainflow keeps its
  internal shapes and maps at import/export.

## Progress log

### 2026-11-07 — phases 0–3 implemented (uncommitted on `feat/interval-kinds`)

Phase 0 findings, which corrected an earlier assumption:

- **Recipes are persisted.** They travel in study saves
  (`PopulationPlotService.savedFor` / `prepareSaved`) and in plot files
  (`brainflow.population-plot.v1`, `serialize` / `reopen`). Both loaders now
  run `upgradePlotRecipe`. The container versions are unchanged because the
  recipe carries its own version. Older builds can't read v2 recipes.
- `plotSpecStore.bandByMode` (localStorage) moves to persist v4, and v3 tokens
  are translated as set-trace bands. `seriesStore` isn't persisted.
- `p4_fixtures.json` keys `sem95`/`ci95` belong to an independently generated
  truth file whose generator states their formulas (1.96, t). They're left
  as-is; only the t interval is asserted against them.
- `aggregation.within` in population-map (slice) requests is a different
  structure and isn't renamed.

What landed:

- `ui2/src/plotting/intervals/`: `types`, `registry` (labels, definitions,
  menu options, `computeInterval`, `intervalKey`), `estimators`, `legacy`
  (per-context tables), `rows` (label resolution: row → frame → custom) and
  `ingest` (tolerant reader).
- `PopulationPlotRecipe` v2:
  - `band: IntervalSpec` and `repeatRows`;
  - `source: 'columns'` draws stored bounds unchanged, one row per position,
    with no transforms;
  - `wsci_cm` and `custom` are refused for `compute`.
- Summary rows add `n` (replaces `count`), `interval_kind`, `interval_level`
  and `interval_df`. The CSV export adds the three interval columns. Set-trace
  frames keep `count` (a voxel count) and gain `meta.interval`.
- Labels:
  - every label site uses the registry;
  - `bandForCentre` replaces three copies of the centre/band coercion;
  - the silent `iqr → ci95` map is gone.
- Rust `api_bridge/src/interval.rs`:
  - `parse_trace_band` accepts `kind[@level]` plus the legacy trace tokens;
  - unknown names return error 2016;
  - the `sem95` fallback is removed;
  - `roi_spread_band` takes the enum.

  The command signature, bindings and permissions are unchanged.

Deliberate behaviour changes:

- The normal-approximation CI uses z(0.975) = 1.959964 rather than 1.96, in
  both TS and Rust, about 0.002% narrower. This is for cross-tool agreement.
- Visible labels:

  | Before | After |
  | --- | --- |
  | "± 1.96 SE" | "95% CI (normal)" |
  | set-trace "95% CI (mean)" | "95% CI (normal)" |
  | "2.5–97.5%" | "95% quantile range" |
  | plot aria "± 95% CI" | "± 95% CI (t)" |
- The set trace can't request `ci_t` (refused in Rust). Its menu is
  normal CI, SD, 95% quantile range, IQR and none.

Independent review (fresh-context agent) found 11 issues. Fixed:

- Stored rows inherit the declared level only when they're of the declared
  kind.
- Stored bounds must fit the summary centre; the summary select is disabled
  for stored bands.
- Ingest invents no levels: a kind that needs one is an error at frame level
  and keeps its own words at row level. Row levels that disagree give a
  `custom` frame spec.
- Generic aliases (`level`, `confidence`, `count`) are dropped.
- A bare number counts as a percentage only from 50 to under 100.
- Decimal levels in tokens now parse.
- The population declaration now takes precedence over an inherited
  `meta.interval`.
- Rust requires an explicit level, matching `parseIntervalKey`.
- The menu shows a saved recipe's band even when it isn't a menu preset.
- A dev-harness note read `count`; it now reads `n`.

Known limits, not fixed:

- The CSV `band_definition` is recipe-level. Series use computed bands only,
  so it can't yet contradict per-row kinds.
- **Pre-existing.** The set-trace SD/SE/normal bands are centred on the ROI
  reducer (median, max, sum), while their definition says "mean". The UI
  could restrict those kinds to `reduce = mean` or name the centre.

Not done:

- No UI entry point calls `ingest.ts` yet; the first consumer is the neurotabs
  reader (Q1). The plan's per-row alias `kind` was deliberately not adopted
  (too generic); `interval_type` and `band_kind` are accepted.
- Phase 4 (design declaration, `wsci_cm` computation) hasn't started.

### 2026-11-07 — aligned with neuromosaic (Q1 interim)

The user's direction: the neurotabs schema is canonical unless it has flaws.
neurotabs doesn't define intervals yet. neuromosaic's implementation notes
(`design/region-effects-plan.md`, "Implementation notes") fix kind names
without levels (`ci_t`, `ci_normal`, `wsci_cm`, `heuristic_se`, `none`) and
write `interval_kind`, `conf_level`, `df` and `n` in `summaries.csv`. Brainflow
now matches it:

- Per-row columns are `conf_level` and `df`, replacing `interval_level` and
  `interval_df`. Those remain accepted on ingest.
- New kind `heuristic_se`: ± z · mean voxel SE. It's labelled as not a CI and
  is display-only (stored bounds); it's refused for compute and for set
  traces.
- Brainflow additionally has `sd`, `se`, `quantile_range` and `custom`.

Points to settle when the schema moves into neurotabs:

1. neuromosaic's C5 plot-profile text still lists `ci95_t` and `wsci95_cm`;
   only its implementation notes are current.
2. `summaries.csv` also has a `level` column meaning region level
   (cluster/subregion), next to `conf_level`. Ingest doesn't read `level` as a
   confidence level.
3. The centre column there is `estimate`; brainflow frames use `value`. The
   neurotabs reader must map it.
4. Kinds brainflow has that neuromosaic lacks (`sd`, `se`, `quantile_range`,
   `custom`) need adding there, or confirming as brainflow-only.
