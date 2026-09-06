# Population movie and montage: delivery A evidence

2026-09-06. Implements the first interaction packet in [the next delivery plan](neurotabs-next-delivery-plan.md); the full population roadmap remains open.

## User workflow

In Population, use the navigation strip to step, scrub or play through actual observations at 5 or 10 observations/s, forward or reverse. These are observations, not acquisition times. Playback gives each completed image its dwell time, buffers on slow reads, and stops at the end, on errors, import/workspace/order changes or unmount. Manual scrubbing pauses it. Space and arrow shortcuts apply when the strip itself has keyboard focus.

Inspect and Montage preserve focus, working membership, reference, probe, camera and compatible scale. Montage displays at most 80 identified previews per page using one sprite/canvas; the focused tile scrolls into view. Choose the whole current plane or a pinned regional patch. Ordinary clicks focus; shift-click/shift-enter retain the existing selection gesture. Source order and explicitly fitted response order drive navigation. New probe values do not silently refit that order.

Exports save the arrangement, preview support and fitted order alongside the existing frozen calculation, focus and source/frame/mask bindings. Reopening validates fitted-order inputs against the verified calculation. An incompatible order gets an explanatory notice and source-order fallback; it cannot change the calculation's participants or membership. Legacy records open in Inspect/source order.

## Implementation and resource boundary

The native plane sampler already retains all sampled context rows. The new focus-only response skips population reduction and omits summary/count/cutout arrays. It still validates source stamps before and after its operation and returns source/mask digests. The frontend reuses the summary only when calculation, geometry and returned revisions agree; source changes require a complete new summary.

The service prefetches up to eight exact original rasters in the foreground response, capped at 8 MiB of numerical slots. There is no independent background job competing with manual focus. Cache hits avoid IPC and summary bitmap conversion; a one-second lease ensures sustained browsing returns to native freshness checks. This is bounded optimistic freshness, not continuous filesystem monitoring. Explicit refresh bypasses the window. No low-rank or interpolated observation images are used.

The anchored summary and cutout sprite have reference-counted image ownership; old committed views can finish drawing before images close. Context/view/scale changes and teardown retire service caches. Native observation plane payload, decoded-source cache, numerical frontend window, bitmap/IPC overhead and saved files remain separately owned. The 8 MiB limit is not a process-RSS claim.

## Reusable native fixture

Generate a standalone 80-person NeuroTabs dataset with Python's standard library:

```sh
python3 tools/create_population_movie_fixture.py /private/tmp/neurotabs-movie-fixture
BRAINFLOW_POPULATION_FIXTURE=/private/tmp/neurotabs-movie-fixture \
  cargo test -p api-bridge population_movie_fixture_native_acceptance -- --ignored --nocapture
```

Choose a new destination: the generator refuses to overwrite an existing directory. Open its `nftab.json` through Brainflow's import workflow. Four labeled groups contain shared, opposing, minority-driven and spatially displaced effects. NaNs outside the synthetic ellipsoid are missing coverage. `expected.json` records the source hashes and expected group behavior. This is explicitly synthetic anatomy in synthetic space.

The acceptance test runs the real manifest import audit, requires `CompareReady` and 80 observations, verifies source hashes, evaluates whole-plane montage, browses all 80 through the native focus path, checks observed values/missingness and verifies plane-cache release. It is opt-in because the generated dataset is external to the repository.

## Measurements and verification

All timings below are local debug-build native evaluation, including source freshness checks. They exclude Tauri IPC, bitmap conversion and screen presentation; they do not certify end-to-end targets.

| Workload | Cold | Warm median | Warm p95 | Retained plane payload |
|---|---:|---:|---:|---:|
| Baseline, 80 × 204,800 values, 128² plane + 80 × 40² cutouts, summary/focus changes | 1554 ms | 8.13 ms | 8.83 ms | 3,105,792 bytes |
| Same workload, focus-only + eight original rasters | existing warm plane | 3.02 ms | 3.26 ms | same plane |
| Audited synthetic fixture, 80 × 32³, 128² plane + whole-plane montage; one requested raster | 158 ms | 1.02 ms | 1.10 ms | 640,000 bytes |

Receipts: `/private/tmp/neurotabs-movie-baseline.log`, `neurotabs-movie-native.log`, `neurotabs-movie-fixture.log`.

The targeted UI run passes 156 tests in 23 suites, including delayed playback, interruption, source-revision changes, image leases, saved order/frame verification, selection and existing population behavior. The six Playwright scenarios exercise real controls/canvases with explicitly simulated IPC and source values; the added scenario checks unchanged summary pixels while stepping, playback, montage focus, return to Inspect, stable selection/probe/scale, and frozen response-order export. Desktop and narrow screenshots are manually inspected.

Final gate receipts and native desktop limitations are recorded in the implementation ledger. Browser harness results are not native GoldenLayout/dialog acceptance. Metadata/similarity orders, grouping, A−B, typed tests, plot authoring, full exploration history and retained/relocated inputs remain the later planned deliveries. Native end-to-end latency and a docked desktop walkthrough remain open.
