# R0 native check: GPU residency Phases 0–2, N50 (2026-11-02)

**Build:** debug `.app` built from `fix/gpu-residency` at `850ce238`, binary dated 22:21 EST, run from `target/debug/bundle/macos/`. `/Applications` was not changed.

**Method:** computer use on the MacBook display, with the window maximised.

## Pass 1 (`9c9d6fe3`, 21:50): two failures

| Check | Result |
|---|---|
| 12 volumes loaded and drawn in one view | ✅ (the old build refused the 9th) |
| Studio Compare B–D with 12 layers in a volume tab | ❌ "slots full": nothing was evicted while Studio was in front (`studio-slots-full-12-layers.jpg`) |
| B–D after freeing slots | ✅ they render straight away (`studio-renders-after-freeing.jpg`) |
| N50: layout-only folder | ✅ offer shown, opened with a "not BIDS-valid" warning (`n50-opened-by-layout.jpg`) |
| Segmentation: paint, lock, unlock, then ⌥-scroll | ✅ stays drawn (`seg-alt-scroll-ok.jpg`); N30 is upright (d1's fix) |
| Segmentation after a Studio round trip | ❌ native view black, next-slice did nothing (`seg-black-after-studio.jpg`) |
| Discard | ✅ no leftover label layer (N37) |

**Fixes:**
- `39a55b79`: a tool tab in front does not pin view-tab layers.
- `900fc01d`: the segmentation view redraws when its image is gone.
- `850ce238`: the watchdog spares an open document's images.

## Pass 2 (`850ce238`, 22:22–22:29): all pass

| Check | Result |
|---|---|
| 12 volumes in a volume tab, then Studio Compare | ✅ A–D all render (`v2-studio-renders-with-12-layers.jpg`) |
| Back to the volume tab | ✅ all 12 layers drawn again (`v2-layers-back-after-studio.jpg`) |
| Segmentation session, paint, Studio round trip | ✅ native view drawn, with the stroke (`v2-seg-drawn-after-studio.jpg`) |
| Next slice after the round trip, then paint | ✅ 115 → 116; painting draws and the count updates (`v2-seg-next-slice-paint.jpg`) |
| Discard | ✅ no leftover layer |
| BIDS run switch (ds000114), with 13 layers and another 4D BOLD open | ✅ ses-test → ses-retest at frame 42/88, with plot and events and no refusal (`v2-bids-run-switch-with-4d.jpg`) |

## Seen but not part of R0

- ⌘O opens the *Mount* picker; choosing a file there fails with "is not a directory" (existing N46).
- *BIDS Explorer › Open dataset* stayed on "Loading…" for more than a minute. No scan appeared in the log, so the picker probably never opened, or was lost when the window left the screen. Not reproduced.
- The window once disappeared from the screen while the app kept running and rendering (PID unchanged); reopening it brought it back. Not reproduced.

## Not covered

- Physical checks.
- Remote mount.
- More than 13 *resident* volumes: by design that needs R3–R4.
