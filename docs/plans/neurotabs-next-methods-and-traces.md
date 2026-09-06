# NeuroTabs: models, time courses and portable comparisons

This delivery extends the existing population workspace. It does not complete the full population exploration plan or certify native desktop interaction latency.

## What the researcher can do

- Fit an ordinary least-squares coefficient contrast using explicitly selected numeric metadata, one declared row per independent participant, and explicit coefficient units. Inspect effect relative to the null, standard error, t, residual degrees of freedom and local participant count.
- Combine two to eight pinned probe snapshots. Overlapping observation/source/frame/probe samples appear once, while set memberships remain recorded. Incompatible units or conflicting overlapping samples are refused.
- Follow the current working selection using cached samples, or retain the pinned membership snapshot. Detached saved live recipes wait for verified relinking; their frozen samples remain available.
- Create real 4D time courses from an original pinned probe, specifying frame range and a common measured-time axis. Clicking a time point focuses that observation's actual frame while leaving cohort analysis frames unchanged. The UI asks for an explicit common-axis declaration; it does not infer TR, register time axes or interpolate gaps.
- Inspect up to eight nonzero component axes and explicitly labeled reconstructions, using the shared anatomical viewport. Return to actual observed maps through the same focus controls.
- Reopen externally linked studies after moving their source directory, with hash/grid/frame verification. Relink saved original plot samples only after re-sampling their frozen source identities and reproducing the saved values.
- Inspect a paged two-factor matrix of descriptive probe means and finite/total observation counts; click a cell to select its exact observations without moving focus.
- Save plot recipes and samples or export a PNG through Brainflow's native save dialog. Browser harnesses use downloads. PNGs include the rendered marks, facet headings and color legend.

## Statistical and identity contracts

OLS supports an intercept plus up to seven explicitly numeric covariates and at most 512 independent participants. A contrast is part of the saved specification. The UI initially selects one coefficient; the native adapter supports a full declared contrast vector. Categorical coding, heteroskedastic corrections, mixed effects and general repeated-measures models remain future adapters. No averaging of displayed t maps becomes a group test.

The solver scales columns before SVD and rejects rank deficiency or ill-conditioning. Finite responses define a local complete-case design. Insufficient residual degrees of freedom or lost local rank produce unavailable results, retaining the local count. Standard errors assume homoskedastic independent errors. A centered response calculation protects against large common offsets. Native evaluation bounds response scratch by processing 512 spatial locations at a time; this is not a full-process memory cap.

The coefficient/SE fixture was checked independently with R's QR-based `lm(y ~ x + z)`, using x = 0:5, z = 0,1,0,1,0,1, and y = 1,2,5,4,9,8. The x coefficient is 1.75, SE 0.1863389981249824 and df 3. Removing the fourth response gives SE 0.176776695296637 and df 2. Tests also check row permutation, column scaling, large offsets and local rank loss. Reference: [R lm](https://www.stat.ethz.ch/R-manual/R-devel/library/stats/html/lm.html).

Time-course sampling is limited to 512 consecutive frames and 8,192 total observation-by-frame samples, sampled in cancelable chunks of 128. Every chunk uses the pinned source and mask hashes. Missing values remain missing; an error or revision mismatch prevents publication of a partial trace. Plot state holds bounded sample frames outside Zustand; population state holds only the focused observation/frame IDs. Original time-course frames and component reconstructions have distinct display identities.

The first frame in the UI is one-based; transport and saved source-frame identities are zero-based. The declared start time applies to the first requested frame. Every source must share that declared axis; temporal registration/resampling is outside this operation.

External relocation preserves relative paths beneath explicitly chosen roots and rejects escapes. Original provenance is retained. Combined plots preserve their original binding records; verify detached originals individually before combining them.

## Acceptance and remaining work

Verification receipts are recorded in the [implementation ledger](neurotabs-implementation-status.md). Native numerical/file tests and browser controls/canvas tests provide different evidence. Synthetic IPC does not establish native dialog, remote I/O or desktop docking acceptance.

Still open: actual surface and parcel population adapters with measured support identities; richer plot layers; automatic or separately specified temporal alignment; broader model adapters; larger-set decomposition and complete resource/performance acceptance; the native desktop walkthrough. Surface/parcel imports remain inspect-only until the adapters are implemented. Matching vertex or parcel counts alone is insufficient to enable them.
