# Sidecar information and set subsets: design

Status: **design for approval, nothing implemented** (2026-11-13).
Branch `design/sidecar-info-and-set-subset`. Mock-ups:
`docs/plans/sidecar-and-set-subset-design/` (five artboards and `canvas.json`;
the hex values in them are the live `--bf-*` token values, map them back to
tokens when building).

## 1. The problem

A folder of analysis output holds many statistical images: several kinds of
map (t, TFCE, corrected p, estimate) for each of many contrasts, 50 or more
files. The working example is a remote folder `…/group/obs` with 54 images
such as `contrast-mod_cue_old_tfce.nii.gz` and
`contrast-xold_cue_old_t_g.nii.gz`. Two things are hard today:

1. Knowing what an image is. The file name is often not enough, and when the
   folder is opened as an image set the Inspector shows only the file name.
2. Loading part of the folder, for example only the TFCE images.

## 2. What exists today

Verified by reading the code on `main` at `44fcd12d`.

### Sidecars

| Piece | State |
| --- | --- |
| Reader: `get_sidecar_card` (`core/api_bridge/src/dataset_card.rs`) | Built. For an image it finds `<stem>.json` beside it. For a name made entirely of BIDS `key-value` parts it also finds every JSON that applies by the inheritance rule, walking up to the nearest `dataset_description.json` or the browse root. At most 16 files of 1 MiB, merged nearest-wins, at most 500 keys. Works on local folders and SSH mounts (prefix reads over SFTP, nothing cached, four at a time). Reads the NIfTI header in the same call. |
| Inheritance for the working folder | **Does not apply.** `contrast-mod_cue_old_tfce` is not entity-formed (`cue`, `old` and `tfce` have no `-`), so only the same-named `.json` is read. A folder-level JSON stating space, subjects or model once is never picked up for these files. |
| Files panel: "Show metadata" in the row menu, or Space | Built. Opens a pinned card beside the Files panel (`SidecarCardView`): an "Image" block from the header and a generic key, value, source-level table, with "Show raw JSON". |
| Inspector | **Nothing.** The "Image set" section (`ImageSetSection.tsx`) shows a pager, a plain dropdown of file names, the file name, and "Contrast remembered per image". The Data section shows Shape, Range, Statistic, Voxel size, TR and Space from the header only. |
| Marker on image rows | None. `.json` files are listed by the backend and then hidden by the Files store, so the tree gives no sign that an image has a sidecar. |
| Meaning of keys | None. The card shows every key as written. No key is treated as a label, a description or a statistic. |
| Header fallbacks | The header's statistic intent is decoded (`StatisticInfo`), and a statistic can be inferred from the file name (marked `*`, "inferred from file name"). The header `descrip` string is shown only in the Image header dialog (Cmd+I). |
| Formats other than JSON | None (`.tsv`, `.txt`, `.md` are not read). |

### Subset selection

The capability the owner remembered is the filter box in the "Open as
switchable layer…" dialog (`OpenImageSetDialog.tsx`). It is weaker than it
looks:

- All images start checked. The filter is a substring match that only hides
  rows; hidden rows keep their state.
- "All" and "None" act on every image, including hidden ones. There is no
  "select what is shown".
- So loading only the TFCE images takes: open the dialog, type `tfce`, click
  None, tick nine rows one by one, open. The other route is to untick 45
  rows. Either way the "k of 54 selected" line has to be checked by eye.
- The Files tree is single-selection (`disableMultiSelection`), so a set
  cannot be built from a multi-file selection. Its search box filters the
  tree but does not feed the dialog.
- After loading, the member dropdown has no search and no grouping, and
  membership cannot be changed.
- Set studio has include and exclude regular expressions in the backend
  (`field_table/src/preview/discovery.rs`), but no UI edits them and they
  serve a different feature.

## 3. Sidecar format and discovery

### 3.1 Position: a note on a file, not a dataset format

Decided with the owner, 2026-11-13. A sidecar is an ad-hoc note attached to
one image, read by a person. neurotabs (NFTab) is the dataset contract: a
table with one row per observation, typed columns, axes, and images attached
by reference, which tools compute on. They are different kinds of thing, and
the rules below keep them from overlapping.

1. **Sidecars are display-only.** They feed About this image, the Files
   summary and the sidecar card. They never become design columns, axes,
   grouping factors or filters in Set studio or Population, and are never
   merged into an observation table. The kind chips in the open-set dialog
   stay name-based for the same reason (5.2).
2. **No folder-level sidecar table.** One file describing every image in a
   folder is what an NFTab manifest is. Brainflow defines no such file of
   its own. Facts shared by a folder are stated per image, or in a
   manifest.
3. **No shared names on disk.** A sidecar is always `<image stem>.json`.
   NFTab files (`nftab.json`, `nftab.yaml`, the observation table) are never
   read as sidecars. The reader already skips `dataset_description.json`
   and `participants.json`; `nftab.json` joins that list.
4. **Loose content, borrowed names.** Only `label` and `description` are
   core. Any other key is optional and unvalidated. Where a sidecar states
   something neurotabs or neuromosaic already names (`n`, `df`, `space`,
   `units`), it should use that name, so a sidecar can later be lifted into
   a table row mechanically. Unknown keys are shown as written.
5. **Nothing is required of neurotabs.** The sidecar adds no vocabulary to
   the shared schema and waits on none. 3.3 records what the schemas cannot
   yet say, as a note for neurotabs, not a prerequisite.
6. **When a table describes the same image, the table wins and the source
   is shown.** In a view driven by a table (Set studio today, an opened
   NFTab manifest later), the row is authoritative for what it states. A
   sidecar fills in only what the row does not say, each fact is labelled
   "From table" or "From sidecar", and a disagreement shows a warning
   instead of a silent choice, as for the header (3.4).
7. **Any crossing is explicit and one-way.** Turning sidecar fields into
   columns would be a deliberate "import sidecars as columns" action that
   writes a table. It is not proposed here and nothing infers it.

The residual overlap is rule 4: a borrowed name such as `stat_kind` may
drift from what neurotabs later defines. Because sidecars are never
validated or computed on, the worst case is a label that reads oddly.

### 3.2 Keys Brainflow recognises

Every key is shown in "All fields". The core keys give the title and the
text; the recognised keys are promoted into the fact list of About this
image when present. Names are matched case-insensitively. The BIDS
spellings are accepted as aliases, because the existing reader is
BIDS-shaped and derivatives pipelines write PascalCase.

Core:

| Shown as | Key | Alias accepted |
| --- | --- | --- |
| Title | `label` | `Name` |
| Description | `description` | `Description` |

Recognised if present:

| Shown as | Key | Name borrowed from | Alias accepted |
| --- | --- | --- | --- |
| Contrast | `contrast` | NFTab's `contrast` role (there a role, not a column name) | `ContrastName` |
| Statistic | `stat_kind`, or `quantity` + `distribution` | neurotabs, neuromosaic | `StatisticType` |
| Degrees of freedom | `df`, or `df_num` + `df_den` | neuromosaic; neurotabs | |
| Subjects | `n`, `subjects` | neuromosaic | |
| Threshold | `p`, `q`, `threshold`, `tail` | neuromosaic | |
| Units | `units` | neuromosaic | `Units` |
| Space | `space`, `template` | both | `SpatialReference` |
| Analysis | `analysis_id` | neuromosaic | |
| Correction | `correction`, `correction_method` | none; free text | |
| Model | `model`, `contrast_weights` | none; free text | |
| Made by | | BIDS | `GeneratedBy`, `Sources` |

Values are shown as written. Brainflow composes "TFCE of *t*(23)" from
`stat_kind`, `distribution` and `df` when it knows the values, and
otherwise prints the value itself. An unknown `stat_kind` is not an error.

Example for the working folder. The smallest useful sidecar is the first
two lines.

```json
{
  "label": "Cue activity scaled by memory strength",
  "description": "Parametric modulation of cue-period activity by later recognition confidence, old items only. One-sample group test across subjects.",
  "contrast": "mod_cue_old",
  "stat_kind": "tfce",
  "distribution": "t",
  "df": 23,
  "n": 24,
  "space": "MNI152NLin2009cAsym",
  "correction": "none",
  "model": "~ cue_old + cue_old:mod + cue_new"
}
```

### 3.3 Note for neurotabs (not a prerequisite)

What the shared schemas cannot yet express, recorded for whenever neurotabs
gains a statistic schema. Sidecars work regardless.

1. **Statistic vocabulary.** neuromosaic's `stat_kind` is `t, z, beta, cope`
   and is marked legacy in favour of `quantity`; neurotabs writes
   `stat_kind` `t` and `f`, and neuromosaic rejects `f`. Neither has F with
   two degrees of freedom in one place, a p-value as the map's own
   quantity, TFCE, or a corrected p.
2. **Correction** (none, FWER, FDR, cluster; and the method) has no field.
3. **Contrast weights and model** have no field. neurotabs' `contrast_spec`
   is only `{kind, term, order}`.
4. **Per-image provenance** has no field; neuromosaic records it per report.
5. **File names like the working folder's parse in neither tool.**
   neuromosaic's parser splits on `_`, so `contrast-mod_cue_old_tfce`
   becomes `contrast=mod` plus loose tokens, and its NFTab adapter labels an
   unannotated map `z`. Brainflow's own BIDS parser
   (`bids_index::parse_name`) rejects the name outright. The grouping in 5.2
   therefore does not rely on entity parsing. A name such as
   `contrast-modCueOld_stat-tfce.nii.gz` parses everywhere.

### 3.4 Discovery rules

Unchanged from the existing reader, plus two additions.

1. `<stem>.json` beside the image (`x.nii.gz` → `x.json`). Existing.
2. Inherited JSON by the BIDS rule, nearest wins. Existing, but only for
   entity-formed names, so not for the working folder (section 2). No new
   inheritance rule and no folder-level file are proposed (3.1, rule 2):
   for irregular names each image carries its own sidecar.
3. **New: fallbacks when a field is absent.** Header `descrip` (as
   "Header note"), header statistic intent, then the file name (contrast
   entity and kind, 5.2). Each fallback fact is labelled with where it came
   from, in the same way the app already marks a statistic "inferred from
   file name". A sidecar value always wins over a fallback.
4. **New: disagreement is shown, not resolved.** If the sidecar and the
   header name different statistics, About this image shows a warning and
   value labels keep following the header (artboard 5).

Reading rules:

- The sidecar is read when a file is selected or a set member becomes
  active, never on hover. The image load does not wait for it.
- Remote cost per image today: the reader lists every folder from the
  image up to its bound (up to 16), reads each applicable JSON, and reads
  the image header, uncached. That is too much per page-turn. Step B
  changes two things: a name that is not entity-formed lists only its own
  folder (nothing above can apply to it), and results are cached per path
  for the session and dropped on Refresh. The expected cost for the working
  folder is then one listing and one small read per image, once. Requests
  are latest-wins so paging quickly through a set leaves no backlog.
- Set members: a set stores only its folder today. It will also store the
  browse root it was opened under, which is the reader's bound.

## 4. Presentation

### 4.1 Inspector (artboards 1, 2 and 5)

A new section, **About this image**, directly under "Image set" and above
Render. It appears for any volume layer that has a sidecar, a header note or
a file-name fact, not only for set members.

- **Collapsible in one click** (owner's request, 2026-11-13). The section
  header is a disclosure button, like Render and Data. Collapsed, the
  section is a single 32px line: the label and the statistic ("Cue activity
  scaled by memory strength · TFCE of *t*(23)"), or the file name when there
  is no label. The choice is remembered for the app, not per image or per
  set, so paging through a set keeps the section as the user left it. A
  failed read or a disagreement with the header still shows a warning mark
  on the collapsed line. While collapsed the sidecar is still read, because
  the line needs the label. Remembering the choice is new work: `Section`
  keeps its open state in component state today.
- Title (`label`), then the description, clamped to six lines with "Show
  more".
- A boxed key-value list of the promoted facts (existing `KeyValue`
  primitive): Statistic, Contrast, Correction, Model, Subjects, Space. Rows
  with no value are omitted.
- Footer: the field count and sidecar file name, and **All fields**, which
  opens the existing sidecar card view (generic table, source levels, raw
  JSON) beside the Inspector. The view and the reader are reused; the host
  is not. Today the only card host is mounted in the Files panel, anchors to
  it, and closes when that panel is hidden, and the two panels are separate
  React roots. Step B adds a second host in the Inspector fed by the same
  store.
- Header meta says where the facts came from: "From sidecar", "No sidecar",
  "Reading sidecar from <mount>…", "Sidecar not read".
- The Data section keeps the header-derived facts (shape, range, voxel
  size). The statistic is stated once per source: About this image states
  what the sidecar says; Data states what the header says.

Image set section changes:

- The picker shows the label when there is one, and the file name stays
  beneath it in mono.
- The scene row reads "Image set · 3 of 9 · <label>".
- The picker becomes a searchable list (artboard 2): type to filter, group
  by contrast, by kind, or in file order. Grouped by contrast it answers
  "show me the other maps for this contrast" in one click.
- **Edit members** reopens the open-set dialog with the current membership.

States (artboard 5): no sidecar (file-name and header facts, plus the name
of the file to create); reading (file-name facts at once, replaced on
arrival); failed (invalid JSON with the line, mount not connected with
Reconnect, over 1 MiB, permission denied), each with "Read again";
disagreement with the header.

### 4.2 Files panel (artboard 3)

- **Marker.** An image row whose `<stem>.json` is in the same listing gets a
  small neutral document glyph at the right edge. It costs no extra I/O,
  because the listing already contains the JSON names before the store
  hides them. It marks only the image's own sidecar, not inherited ones.
  This revisits the earlier "no room for a sidecar icon" choice; see open
  question 4.
- **Selected file summary** (the block under the tree, which already shows
  dimensions and size): gains the label, a three-line description, Statistic
  and Subjects, and **All fields**. It is fetched on selection.
- **Hover** stays free of backend calls and shows the name only, as decided
  for dataset cards.
- Space and "Show metadata" keep opening the full card. The card gains the
  same About block above its generic table.

### 4.3 Wording

Sentence case throughout. In the artboards the looped rows (picker, dialog)
show statistic symbols upright; the build sets them in italic everywhere. "Sidecar" is the user's own word and is kept.
"Kind" is used for the map type taken from a file name, and "Statistic" only
when a sidecar or header states it. Statistic symbols are italic (*t*, *z*,
*p*).

## 5. Subset selection

### 5.1 The flow (artboard 4)

Loading only the TFCE images becomes: right-click the folder, "Open as
switchable layer…", click the **tfce** chip, Open. Two clicks inside the
dialog instead of eleven.

Changes to the dialog:

1. **Kind chips.** The dialog groups the folder by the ends of the file
   names and offers one chip per group with its count (`t_g 9`, `tfce 9`,
   `fwer 9`, …). Clicking a chip selects exactly that group and shows only
   it; more chips can be added. With no chip pressed the dialog behaves as
   now. Chips appear only when the grouping covers the folder (5.2).
2. **Buttons act on what is shown.** "Select shown" and "Clear shown"
   replace All and None. With no filter they mean all and none.
3. **Filter terms.** Space-separated terms must all match; a leading `-`
   excludes (`cue -probe`); `*` is a wildcard. Still plain text, no regular
   expressions.
4. **Honest count.** "Showing 9 of 54 · 9 selected, none hidden". If
   selected images are hidden by the filter it says how many, so nothing is
   opened unseen.
5. **Default name.** The set name follows the choice: "obs · tfce".
6. **Show descriptions.** Rows show the sidecar label and statistic when
   they exist, with the file name beneath. Local folders read them at once;
   on a remote mount they arrive in the background and the list is usable
   meanwhile. This needs one new batched backend command (section 6).
7. The dialog's raw palette classes and the oversize inputs are replaced
   with `ui/bf` primitives while it is open for change.

Also:

- **From the Files search box.** When the tree is filtered and the matches
  are images in one folder, a line under the search box offers "Open these
  as a set" (artboard 3). It opens the dialog with those images selected.
- **After loading.** Search and grouping in the picker, and Edit members
  (4.1).

### 5.2 How kinds are found

In this version chips come **from file names only**, computed once when the
dialog opens, so they never regroup while sidecars arrive from a remote
mount. Sidecar statistics annotate the rows; they do not drive the chips,
because sidecars are display-only (3.1, rule 1).

The rule, for names not made of BIDS entities:

1. Remove the extension, lower-case, split on `_`.
2. A candidate grouping is a set of endings (one to three trailing parts)
   with at least two members, such that each file has exactly one ending
   from the set and the stems left over are the same for every ending: a
   complete crossing of stem by ending.
3. If several candidates qualify, take the one that covers the most
   images, and among those the one with the **most stems** (the shortest
   endings). With contrasts `mod_cue`, `mod_probe`,
   `xold_cue`, `xold_probe` and endings `t`, `tfce`, this picks 4 × 2, not
   2 stems × `cue_t`, `cue_tfce`, `probe_t`, `probe_tfce`.
4. The crossing may be imperfect within fixed limits: up to 10% of the
   files (at least one, at most five) may fit no ending and go to an
   **Other** chip, and up to 10% of the stem-by-ending cells may be empty.
   Beyond that there are no chips. A stem that is missing images is
   admitted only if it still holds at least half of the kinds and at least
   two; one matching ending alone proves nothing. Folders of fewer than
   four images get no chips.

For the working folder this yields `t_g`, `tfce`, `fwer`, … against nine
contrasts, and keeps `t_g` whole because `g` alone does not give a crossing
(the `tfce` files do not end in it). The stem, with a leading `contrast-`
removed, is the contrast used for grouping in the picker.

Names made entirely of BIDS entities use the `stat-` value instead; failing
that the suffix when suffixes differ (`T1w`, `bold`, `mask`), else `desc-`,
else the suffix. Names that end in a number (`zstat1`, `cope3`,
`spmT_0001`, `con_0002`) use the name without that trailing number, and
only when some name repeats with different numbers.

**As built (step A, 2026-11-13)**: `ui2/src/utils/imageSetKinds.ts`, with
the corpus below as `__tests__/imageSetKinds.test.ts`. Differences from the
mock-up: the caption reads "6 kinds × 9 names", since a stem is not always a
contrast; the catch-all chip is "Ungrouped", so a real ending called `other`
cannot be confused with it; the count line says "N not shown" and offers
"Deselect the N not shown".

### 5.3 Irregular names

Regular names group well. The rule must stay safe when names are not
regular (owner's requirement, 2026-11-13). Two different things can go
wrong, and they are guarded differently.

**Selecting something unseen.** Prevented outright:

- A chip only sets checkboxes and the filter. The rows it selected are on
  screen, and the count line states "Showing 9 of 54 · 9 selected, none
  hidden". Nothing opens unseen.
- Every image is in exactly one group. Chip counts sum to the folder's
  image count, and the caption says so ("6 kinds × 9 contrasts, every image
  in one group"). "Other" exists whenever a file fits no ending.
- Chips and the typed filter combine (both must match). A chip never
  overwrites typed text. The first chip selects exactly its images; a
  further chip adds or removes only its own. Releasing the last chip
  restores the selection from before the first chip, unless rows were
  changed by hand meanwhile, in which case that work is kept.

**A misleading grouping.** Reduced, not eliminated:

- The rule prefers no chips to a doubtful grouping. There is deliberately
  no fallback of "any ending shared by a few files": on a folder with one
  stray file that would produce chips such as `cue_old_tfce`, with the
  contrast swallowed into the kind.
- No chips when there are fewer than two groups, or one group holds more
  than 90% of the images.
- A chip shows the text found in the names (`t_g`), never a translated
  statistic. Meaning comes only from a sidecar or the header.
- Known residual: a contrast whose own name ends in a kind word (`…_old_t`
  beside `…_t`) can still be split wrongly when the crossing happens to
  stay within the limits. The chip text and the visible rows are the
  safeguard, and the case is in the test corpus so its behaviour is at
  least fixed and known.
- When there are no chips the task still takes two actions on any folder:
  type in the filter, press "Deselect the N not shown".
- Known residuals, pinned by tests or accepted: kind-first names
  (`tfce_mod_cue`) group by their last part; `a_1, a_2, a_mean` yields
  chips `1`, `2`, `mean`; an FSL folder with two strays among six images
  gets no chips because the stray limit there is one.

**A single layer, outside a set.** The grouping needs the whole folder. For
a set member, About this image uses the set's grouping. For a lone layer it
uses the folder listing if the Files panel has it, and otherwise shows no
kind or contrast from the name, only the file name. `tfce` versus
`new_tfce` cannot be decided from one name.

Test corpus (unit tests, before any UI): the working folder's real names;
the same with three files missing and two extras (`mask.nii.gz`); the
4 × 2 tie-break case; `a_g, a_t_g, b_g, b_t_g`; FSL (`zstat1`,
`thresh_zstat1`, `cope1`, `varcope1`); SPM (`spmT_0001`, `con_0001`,
`beta_0001`, `ResMS`); a folder of unrelated names; a contrast name ending
in a kind word; mixed case and `.nii` beside `.nii.gz`; a single-kind
folder. Each case fixes the expected groups, including the expected "no
chips".

## 6. What would be built, in order

Each step is usable alone.

| Step | Content | Backend change |
| --- | --- | --- |
| A | Dialog: shown-only buttons, filter terms, honest count, kind chips from file names, default name, `ui/bf` restyle. Files: "Open these as a set". | None |
| B | Inspector "About this image" with the promoted keys, fallbacks, states and remembered collapse; All fields through a second card host in the Inspector; label in picker and scene row; sets store their browse root. Files: marker and richer selected-file summary. | `SidecarHeader` gains `description` and the decoded statistic. `get_sidecar_card` lists only the image's folder for names that are not entity-formed, and its results are cached per session. The reader's skip list gains `nftab.json` and `nftab.yaml`. |
| C | Picker search and grouping; Edit members; descriptions in the dialog rows. | One batched command returning the promoted fields for up to 128 paths, under a cancellable ticket like `probe_dataset_markers`. |

Verification planned per step: unit tests for the grouping rule on the real
file names and on adversarial ones; mocked-UI tests for the dialog and the
section states; the in-process SFTP fixture for remote reads; then a native
check on the Trillium mount, since nothing remote counts as seen until then.

## 7. Open questions for the owner

1. **Which tool writes the maps in `group/obs`, and does it write sidecars
   today?** If it does, its keys go into the promotion table first. If it
   does not, is writing the section 3.2 object from that tool acceptable?
2. **Key names.** Settled 2026-11-13 by 3.1: `label` and `description` are
   core, other keys are optional, unvalidated and borrow existing names.
3. **Folder table.** Settled 2026-11-13 by 3.1, rule 2: none. A folder-wide
   description is an NFTab manifest.
4. **Row marker in Files.** Add the glyph, reversing the earlier "no room"
   choice, or keep rows clean and rely on the selected-file summary?
5. **About this image for every volume layer**, or only for set members?
   Recommended: every volume layer.
6. **Picker grouping by contrast and kind**: in scope for this work, or
   later? It depends on the same grouping rule as the chips.
7. **Remembering a choice.** Should the dialog remember the last kind chosen
   for a folder, for the session or across sessions? Recommended: session
   only, since sets themselves are session-local.
8. **Multi-selection in the Files tree** as another way to build a set: not
   proposed here because the tree is single-selection by design. Wanted?
9. **Free-text notes** (`<stem>.md` or `.txt`): not proposed; `description`
   covers it. Wanted?
11. **File names upstream.** Would the pipeline write entity-formed names
    (`contrast-modCueOld_stat-tfce.nii.gz`)? That makes grouping exact and
    turns BIDS inheritance on, so one folder-level JSON could state the
    shared facts. The design does not depend on it.
10. **The `_g` ending** in `t_g`: what does it denote? If it is a constant
    of the pipeline the chip can drop it.
