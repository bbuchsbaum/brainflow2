# Brainflow vision

Brainflow should make a brain-image summary easy to interrogate. A researcher
sees a pattern, inspects the people behind it, changes the grouping or assumptions,
and understands why the pattern changes. Every summary remains connected to its
source observations and anatomical context.

This is the product direction agreed on 2026-10-25, not a claim that the workflow
is complete. The [NeuroTabs population plan](plans/neurotabs-population-exploration.md)
defines the detailed contracts; its linked implementation records carry delivery
status. The [original vision and idea notes](../memory-bank/archive/root-cleanup-2026-10-25/README.md)
remain available as historical material.

## The next product milestone

**Open a cohort, find an interesting regional pattern, inspect its contributors,
test its sensitivity, and export a figure that explains it honestly.**

Make this one coherent experience:

1. Open a collection with identifiable participants, declared value types and
   visible coverage. Establish comparable anatomy and display scales.
2. Inspect mean, variability and consistency in linked views. Select a region
   and see the distribution of contributing observations, including missingness.
3. Select a point in that distribution and inspect the actual person's map at
   the same anatomical location. Move between individual and summary views
   without losing the region, selection or reference population.
4. Preview the consequences of excluding a participant, changing a threshold,
   regrouping observations or comparing declared splits. Keep the original
   result available and make each change reversible.
5. Export the views and distributions together with the membership, units,
   thresholds, calculation and sensitivity settings needed to interpret them.

Success means a researcher can explain what produces a pattern, who contributes
to it and which choices change it. Evaluate those explanations and interpretation
errors alongside task completion, responsiveness and export quality.

## Priorities for the experience

**Show complementary summaries together.** Mean, spread, consistency and coverage
answer different questions. Prefer readable, linked panels with explicit units
and definitions. A mean of subject t-values must retain that value role;
threshold-exceedance share must not silently become inferred biological prevalence.

**Keep actual observations within reach.** A synchronized subject view and the
complete distribution are central. Mosaics, fixed-scale flicker, residual tours
and plots should be different ways to inspect the same population, with stable
identities and shared selection. Label sampled examples and derived maps clearly.

**Make sensitivity visible and reversible.** Preserve the reference result while
previewing alternatives. Distinguish a display adjustment, a membership change
and a model refit, and show pending work rather than presenting stale results as
current. The [retained display recipes](plans/neurotabs-population-exploration.md#display-ideas-retained-from-the-root-notes)
provide candidates for this workflow.

Composite color encodings, tiny anatomical glyphs and embeddings remain optional
experiments. They should earn a place by helping users interpret the data more
accurately than simpler linked views. Apparent clusters require inspection of
their contributors and fit context before they acquire scientific meaning.

## Engineering serves the workflow

Preserve intensity meaning, precision, coordinates and consistent display
behavior first. Measure responsiveness across the complete interaction, including
loading, computation, transfer and presentation. Rust, GPU computation, memory
mapping and caching are useful where they improve that measured experience.
Approximation or compression needs an explicit accuracy contract before replacing
a full calculation. The original speedup, latency and compression numbers were
aspirations and are not acceptance evidence.

## Shared surface and volume controls

Use common surface and volume layer selection, visibility, ordering,
opacity, thresholds, colormaps and blend controls, with geometry kept separate.
Scalar, label, RGBA and outline layers need explicit capabilities and suitable
controls. A thin surface adapter should translate shared display state into the
surface renderer instead of duplicating the UI model. Validate multiple overlays,
label halos/outlines, ordering and updates on both surface and volume paths.
Establish actual backend capabilities before adopting limits or fallbacks from
historical plans. Surface parity should support the same inspection workflow.

## Interface design intent

Use clear hierarchy, precise controls, restrained plot grids and consistent
styling across shell, inspectors and plots. Preserve anatomical context and make
selection, reference and preview states easy to distinguish. Consult the
[current redesign plan](plans/ui-redesign-2026-10.md),
[UI contract](design-system/ui-contract.md) and live theme tokens. Archived palette
snippets and completed checkboxes do not establish current visual acceptance.

## Longer-term possibilities

Interactive contrast/model exploration, seed connectivity, event-related and
time-frequency views, dynamic networks, multilevel models and custom analyses
remain worthwhile possibilities. The [plugin protocol](analysis_plugins.md)
provides an extension boundary. Sequence new capabilities according to how they
improve the demonstrated inspection workflow; they are not parallel promises
to make every analysis instantaneous.

Keep one product direction here, detailed behavior in linked plans, and current
delivery evidence in their implementation records. Add a new feature when its
place in the workflow is clear, rather than expanding an undifferentiated list
of ambitions.
