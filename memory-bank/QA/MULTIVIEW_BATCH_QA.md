# Multi-View Batch Rendering – Manual QA Checklist

Owner: Foundations Upgrade Sprint  
Last updated: 2025-10-27

## Preconditions
- Build from `feature/foundations-upgrade-1`.
- Launch Brainflow with a clean workspace (remove `brainflow2-workspace` from localStorage).
- Ensure feature flag is enabled in-app: Status bar → `Multi-view Batch` toggle → ON.
- Load sample data set: `MNI152NLin2009cAsym_T1w_1mm` template plus one user volume (toy_t1w.nii.gz).

## Test Matrix

| Scenario | Steps | Expected |
|----------|-------|----------|
| **Locked layout resize** | 1. Confirm layout locked.<br>2. Drag axial panel wider and taller.<br>3. Observe sagittal & coronal resize simultaneously. | All three views update in a single render cycle (no stagger). Images remain synchronized; crosshair stays centered. |
| **Rapid crosshair sweep** | 1. Use mouse drag to sweep crosshair through axial view.<br>2. Repeat for coronal view.<br>3. Watch console (or fps overlay) for render cadence. | With batch mode enabled, coordinator queues one job per frame; no flicker. FPS stays > 45 on Apple M-series baseline. |
| **Layer opacity change** | 1. Add atlas overlay.<br>2. Toggle overlay visibility and adjust opacity slider.<br>3. Observe view updates. | All visible views refresh together; no stale layers. |
| **Toggle batch flag runtime** | 1. Switch flag OFF via status bar toggle.<br>2. Resize panel again.<br>3. Switch flag ON; repeat resize. | OFF: renders fire sequentially (visible slight stagger). ON: revert to single frame updates. No errors in console. |
| **Error fallback** | 1. With devtools open, run `window.setRenderMultiViewEnabled(true)` if not already.<br>2. Temporarily tamper with devtools to throw inside `renderViewStateMulti` (simulate rejection).<br>3. Resize panel. | UI logs fallback warning, but dimensions update and render completes without crash. |
| **Template reload** | 1. Switch to a different template via menu.<br>2. Verify batch toggle persists via store.<br>3. Resize and move crosshair. | Flag remains ON; new volume respects batch pipeline. |

## Post-Run Checks
- Toggle flag back OFF before exit if regressions observed.
- Capture console logs and screenshots for any anomalies (attach to sprint ticket T-012/T-013).

## Results Log
- Date: 2025-10-27
- Template(s) tested: MNI152NLin2009cAsym_T1w_1mm (template), toy_t1w.nii.gz
- Hardware / GPU: Apple M3 Max (desktop build via Tauri dev)
- Findings: Rapid intensity slider scrubbing while multi-view batching enabled tripped render-loop guard (false positive) and forced app reload.
- Follow-up actions: Relax guard by combining rate + cadence thresholds (240fps & <6ms avg interval, 6 consecutive seconds) and capture diagnostics via `window.__renderLoopDiagnostics`; rerun checklist after patch.

## Sign-off Field
- Tester: ____________________
- Date: ______________________
- Result: ✅ / ⚠️ (attach notes)
