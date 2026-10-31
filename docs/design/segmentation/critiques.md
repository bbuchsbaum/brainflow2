# Segmentation design: critiques and what is left to test

The segmentation UI was designed by a visual hill climb (October 2026):
each round rendered every state from mock components, three critics scored
the screenshots against fixed rubrics, and the next round fixed their
"static" issues. Three critics, each with a different lens:

- **Tufte**: data-ink and image primacy, label and contour encoding,
  comparison design, typography and chrome hierarchy, integrity.
- **Jobs**: focus, simplicity, defaults and flow, craft, delight.
- **Operator** (an experienced hippocampal subfield and WMH rater): tracing
  efficiency, safety and trust, multi-contrast geometry, protocol and
  review, fatigue.

The prompts, rubrics and JSON schema are in `tools/design/hillclimb/`. The
final screens are in [reference/](reference/README.md); the design and its
decisions in `ui2/src/modules/segmentation/DESIGN.md`. Raw critiques per
round were kept in the ignored `cruft/hillclimb/segmentation/round-*/critiques/`.

## Score history

Overall score per critic. R0: the best of three directions (A Workstation,
B Reading room, C Protocol-guided); R1–R4: the chosen hybrid, direction H,
on its seven core states; R5–R6: H's eight workflow states (the core states
then scored 8–8.5). R4 and R7 were targeted static passes, not scored.

| Critic | R0 | R1 | R2 | R3 | R4 | R5 | R6 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Tufte | 7 (A) | 8 | 8 | 8 (high) | — | 8 | 8.5 |
| Jobs | 7.5 (C) | 7.5 | 8 | 8.5 | — | 7.8 | 8.2 |
| Operator | 7.5 (A) | 8 | 8 | 8 | — | 7 | 8 |

Round 0, all directions: Tufte A 7, B 6, C 6; Jobs A 6.5, B 6.5, C 7.5;
Operator A 7.5, B 5, C 7.

Round 6 sub-scores and per-state scores:

| Critic | Sub-scores | ai-prompt | ai-consent | lesion | lesion-overview | contrast-aids | history | save | resume | setup |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Tufte | data-ink 8 · encoding 9 · comparison 8 · typography 8 · integrity 9 | 8 | 9 | 8 | 8 | 9 | 8 | 9 | 9 | 8 |
| Jobs | focus 8 · simplicity 7.5 · defaults 8.5 · craft 8.5 · delight 8 | 8 | 8.5 | 7.5 | 8.5 | 8 | 8 | 8.5 | 9 | 8 |
| Operator | efficiency 8 · safety 8 · geometry 7 · review 8 · fatigue 7 | 8 | 8 | 8 | 8 | 8 | 8 | 8 | 8 | 7 |

Round 7 applied every round-6 issue marked "static" (see the reference
manifest's `changes`).

## Final verdicts (round 6)

- **Tufte, 8.5.** "Every screen now reads from one session model … I found
  no regressions." More static rounds: not as a full round; the three
  remaining static issues were a short targeted pass (done in round 7). "The
  rest (dock use, hover-to-outline, filter noise, real FLAIR texture) needs
  interaction or real data."
- **Jobs, 8.2.** "Round 6 did what round 5 asked: it cut." The one
  regression was the crowded lesion state (fixed in round 7: T1w/T2w replace
  the cuts while typing). More static rounds: no; "what remains (dock size,
  lens feel, unsharp at 0.4 mm, AI on real subfields, the lesion strip in a
  real WMH workflow) needs interaction or real data."
- **Operator, 8.** "Lesion rating now resembles real work … History, resume
  and save report the same session." More static rounds: no, beyond a small
  pass for the registration check, over-reach coverage and the AI/journal
  match (done in round 7). "What's left (rhythm, latency, confluent lesions,
  real misregistration) needs a prototype on real data."

## Prototype test priorities (operator, round 6)

Run these on the implemented module with real (explicitly approved) data
before calling the design settled:

- [ ] nnInteractive per-slice accept loop on real 0.4 mm oblique T2:
  seconds per slice, over-reach rate, Accept-then-next rhythm over 20 slices.
- [ ] LST-AI seed editing on real FLAIR including confluent WMH: the > 50%
  partial-volume brush, row split/merge, volume agreement with the seed and
  a second rater.
- [ ] Registration check with a planted 1–2 mm T1 → T2 offset: do raters
  catch it?
- [ ] Crash → resume → save as draft → complete, with bids-validator on the
  output.
- [ ] Lens, flicker and filter latency at 4–6× zoom.
- [ ] Blinded two-rater review and reconciliation.

## Interactive and real-data issues (rounds 3–6)

Issues the critics marked as needing interaction or real data. A static
part may already be in the design (noted); the check itself is still open.

**Round 3**

- [ ] (Tufte 5, real data; multi-contrast, tracing) The pack example must
  not be mistaken for the user's work. Static part done: neutral hairline
  plus flat fill, keyed "example". Check with a real pack's example.
- [ ] (Tufte 6, interactive; all) Stroke hierarchy, halos, inset fill and
  the neighbour line are validated only on 1 mm imagery; held keys and brush
  feel are tooltips only. Test on real 0.4 mm hippocampal T2.
- [ ] (Jobs 3, real data; tracing, zoom, blocked) Inner-edge strokes plus
  dark rims may read as 3–5 parallel lines at shared borders. Re-judge on
  real 0.4 mm data; if it persists drop the inner rim on inactive labels.
- [ ] (Jobs 4, real data; tracing and others) Orthogonals fitted to the
  structure give little sense of place. Static part done: 80% fit and a
  whole-slice locator. Re-judge on native data.
- [ ] (Jobs 6, interactive; blocked, proposal, review) Does the blocked card
  fade, do checks tick themselves, does Approve become primary after the
  last region, how fast do flicker and next/previous feel?
- [ ] (Operator 4, interactive; review) Per-region reconciliation. Static
  part done: regions with Keep A / Take B / Edit on 1/2/E. Check speed, and
  whether B's departure should draw at full colour on row hover.
- [ ] (Operator 6, real data; tracing, zoom) Brush and push feel, snap to
  shared edges, latency and how the views hold on real 0.4 × 0.4 × 2 mm
  oblique T2: a timed session on a real dataset.

**Round 5**

- [ ] (Tufte 7, interactive; history) Dock height. Static part done: 8 rows
  (~25%), resizable and collapsible. Check in use.
- [ ] (Jobs 8, interactive; history) Dock size and how often hover-to-outline
  is used.
- [ ] (Operator 7, interactive; history) Dock as a toggle or overlay,
  filters by label and k; AI status on branch steps and a guarded restore
  (static part done).
- [ ] (Operator 8, real data; contrast-aids) Unsharp at 0.4 mm may amplify
  noise and shift the SRLM edge. Static part done: per-step pack filters
  badged "set by pack", filtered strokes recorded, Space stays pan.

**Round 6**

- [ ] (Jobs 6, interactive; history) One step count (done in round 7); test
  the dock size and hover-to-outline in use.
- [ ] (Operator 4, real data; lesion, lesion-overview) One row per
  component breaks on confluent WMH (Fazekas 2–3): row split/merge, a
  recorded PV/deep distance rule, per-voxel seed provenance (kept, added,
  removed) for agreement with the seed.
- [ ] (Operator 5, interactive; lesion) FLAIR ↔ T1w flicker in the primary,
  the k range on span-bar hover, FLAIR/T1w values under the cursor while
  typing lacune or PVS. Static parts done: T1w/T2w at the primary's scale
  while typing; Fazekas marked provisional until every row is reviewed.
- [ ] (Operator 6, interactive; ai-prompt, contrast-aids) Bar density, the
  island ring drawing the eye, toggles that look off while active. Static
  parts done: a two-line AI bar with four actions; switches follow what is
  shown. Measure in a prototype.
