# Group Map Display Ideas

Curated ways to move beyond a single random-effects t-map when you have a stack of subject t-maps (T[s, x, y, z] or surface vertices). Mix and match the stats and visuals; bias toward quick-reading, presentation-ready looks.

## What to Compute (per voxel/vertex)
- Central tendency: mean or median t (robust: median/trimmed mean).
- Spread: SD or MAD; coefficient of variation (σ/|μ|) to flag strong-but-unstable effects.
- Prevalence/consistency: proportion above threshold; threshold-weighted overlap maps (TWOM); sign-consistency C = mean(sign(t_s(v))).
- Subject innovations: residual R_s = t_s − μ; Z-scores across subjects for outlier spotting.
- Mixture/prevalence models: estimate active vs inactive subpopulations instead of a single Gaussian effect.
- Low-dimensional components: PCA/ICA across subjects to capture between-subject variation with subject weights.

## Static Visuals
- Three-panel summary brain: A) group mean μ; B) variability (σ or CV); C) prevalence/consistency (P or C).
- HSV channel map: hue = sign(μ), saturation = |C| or P (consistency), value = |μ|; bright + vivid = strong + consistent.
- Overlap contours on mean: mean t as base; contours or soft blobs for ≥50/75/90% responders; shows core vs fringe.
- Subject mosaic (“Brainglance” style): flatten cortex or axial slices; rows = subjects, cols = parcels/slices; cell = subject mean t per ROI; cluster rows.
- ROI glyphs: at ROI centroids, tiny raincloud/violin or radial petal plots showing subject distributions.

## Dynamic / Animated
- Subject flicker movie: cycle subjects at 5–10 fps with fixed scale; stable regions look steady, idiosyncratic ones flicker.
- Cumulative mean build-up: frame k shows mean of first k subjects (optionally SD) with final outline; add line plot of effect vs N.
- Threshold-sweep overlap: animate overlap maps as τ increases (e.g., t = 1→6); watch “core vs halo” shrink.
- Innovation tour: per subject, show μ vs residual R_s (or Z-residual); outliers pop; optional morph μ → subject map → μ.
- Component scrubber: for PCA/ICA components, show map + subject weights (bars/strip, colored by behavior); scrub components.

## Interactive Dashboard Sketch
- Brain view: toggle μ, σ, P, C, components; optionally blend μ as color with P as alpha.
- Subject panel: click voxel/ROI to see per-subject stripplot/histogram with group summary; optional brain–behavior scatter.
- Subject space: 2D embedding (MDS/UMAP) of subjects; selecting a point highlights that subject’s map; cluster to spot subtypes.

## Figure Recipes
- Beyond the group map: A) μ on surface; B) prevalence contours (≥50/≥80%); C) σ map; D) per-subject raincloud for key ROI.
- Individual innovations: top row subjects with highest positive residual in ROI A (μ + R_s); bottom row highest negative; tie to behavior.
- Group emergence movie: cumulative mean animation with overlaid ROI effect-vs-N trace; freeze frames on stable vs unstable regions.

## Extra Riffs
- Reliability inset: alongside any map, add a tiny “stability sparkline” showing voxelwise agreement percentile so readers see robustness at a glance.
- Split-half echo: animate A/B split means per frame; regions that swap sign between splits get hashed overlay—great for conveying fragility.
- Behavioral alignment: reorder subjects in flicker/build-up by a behavioral score to show gradients; add vertical cursor marking tertiles.
