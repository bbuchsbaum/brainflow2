//! Interval kinds for the cross-set trace band (`sample_set_trace_at_world`).
//!
//! Mirrors the UI registry in `ui2/src/plotting/intervals`; see
//! `docs/plans/interval-kinds.md`. The command's `band` argument is the UI's
//! `intervalKey`: a canonical kind, optionally with a level (`kind@level`).
//! The pre-registry trace tokens are still accepted for one release and keep
//! their set-trace meaning (`ci95` was the 2.5–97.5% quantile range here, not
//! a CI of the mean). Unknown names are errors, never a silent fallback.

/// A band the bridge computes over one member's ROI voxel values.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum TraceInterval {
    /// Degenerate band at the centre.
    None,
    /// `centre ± SD` (n − 1).
    Sd,
    /// `centre ± SD / √n`.
    Se,
    /// `centre ± z((1 + level) / 2) · SD / √n`.
    CiNormal { level: f64 },
    /// Central `level` sample quantiles (type 7); the IQR at 0.5.
    QuantileRange { level: f64 },
}

/// Parse the command's `band` argument. Errors name what was not understood.
pub(crate) fn parse_trace_band(band: &str) -> Result<TraceInterval, String> {
    // Legacy set-trace tokens (plotSpecStore v3 and older callers).
    match band {
        "sem95" => return Ok(TraceInterval::CiNormal { level: 0.95 }),
        "ci95" => return Ok(TraceInterval::QuantileRange { level: 0.95 }),
        "iqr" => return Ok(TraceInterval::QuantileRange { level: 0.5 }),
        _ => {}
    }
    let (kind, level) = match band.split_once('@') {
        Some((kind, level)) => {
            let level: f64 = level
                .parse()
                .map_err(|_| format!("Unreadable interval level in band {band:?}."))?;
            if !(level > 0.0 && level < 1.0) {
                return Err(format!(
                    "Interval level must lie strictly between 0 and 1 (band {band:?})."
                ));
            }
            (kind, Some(level))
        }
        None => (band, None),
    };
    let no_level = |interval: TraceInterval| match level {
        None => Ok(interval),
        Some(_) => Err(format!(
            "The {kind} interval takes no level (band {band:?})."
        )),
    };
    // Like the UI's `parseIntervalKey`: a kind with a level must state it.
    let needs_level = |kind: &str| format!("The {kind} interval needs a level (band {band:?}).");
    match kind {
        "none" => no_level(TraceInterval::None),
        "sd" => no_level(TraceInterval::Sd),
        "se" => no_level(TraceInterval::Se),
        "ci_normal" => level
            .map(|level| TraceInterval::CiNormal { level })
            .ok_or_else(|| needs_level(kind)),
        "quantile_range" => level
            .map(|level| TraceInterval::QuantileRange { level })
            .ok_or_else(|| needs_level(kind)),
        "ci_t" | "wsci_cm" | "heuristic_se" | "custom" => Err(format!(
            "The {kind} interval is not computed for set traces (band {band:?})."
        )),
        _ => Err(format!("Unknown spatial dispersion band {band:?}.")),
    }
}

/// Standard normal quantile (Acklam's rational approximation; relative error
/// below 1.2e-9, ample for f32 bounds).
pub(crate) fn normal_quantile(p: f64) -> f64 {
    const A: [f64; 6] = [
        -3.969_683_028_665_376e1,
        2.209_460_984_245_205e2,
        -2.759_285_104_469_687e2,
        1.383_577_518_672_69e2,
        -3.066_479_806_614_716e1,
        2.506_628_277_459_239,
    ];
    const B: [f64; 5] = [
        -5.447_609_879_822_406e1,
        1.615_858_368_580_409e2,
        -1.556_989_798_598_866e2,
        6.680_131_188_771_972e1,
        -1.328_068_155_288_572e1,
    ];
    const C: [f64; 6] = [
        -7.784_894_002_430_293e-3,
        -3.223_964_580_411_365e-1,
        -2.400_758_277_161_838,
        -2.549_732_539_343_734,
        4.374_664_141_464_968,
        2.938_163_982_698_783,
    ];
    const D: [f64; 4] = [
        7.784_695_709_041_462e-3,
        3.224_671_290_700_398e-1,
        2.445_134_137_142_996,
        3.754_408_661_907_416,
    ];
    if !(p > 0.0 && p < 1.0) {
        return f64::NAN;
    }
    let tail = |q: f64| {
        (((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5])
            / ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1.0)
    };
    const P_LOW: f64 = 0.02425;
    if p < P_LOW {
        tail((-2.0 * p.ln()).sqrt())
    } else if p > 1.0 - P_LOW {
        -tail((-2.0 * (1.0 - p).ln()).sqrt())
    } else {
        let q = p - 0.5;
        let r = q * q;
        (((((A[0] * r + A[1]) * r + A[2]) * r + A[3]) * r + A[4]) * r + A[5]) * q
            / (((((B[0] * r + B[1]) * r + B[2]) * r + B[3]) * r + B[4]) * r + 1.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_canonical_keys_and_legacy_trace_tokens() {
        assert_eq!(parse_trace_band("none"), Ok(TraceInterval::None));
        assert_eq!(parse_trace_band("sd"), Ok(TraceInterval::Sd));
        assert_eq!(parse_trace_band("se"), Ok(TraceInterval::Se));
        assert_eq!(
            parse_trace_band("ci_normal@0.95"),
            Ok(TraceInterval::CiNormal { level: 0.95 })
        );
        assert_eq!(
            parse_trace_band("quantile_range@0.5"),
            Ok(TraceInterval::QuantileRange { level: 0.5 })
        );
        assert_eq!(
            parse_trace_band("quantile_range@0.9"),
            Ok(TraceInterval::QuantileRange { level: 0.9 })
        );
        // Legacy tokens keep their set-trace meaning.
        assert_eq!(
            parse_trace_band("sem95"),
            Ok(TraceInterval::CiNormal { level: 0.95 })
        );
        assert_eq!(
            parse_trace_band("ci95"),
            Ok(TraceInterval::QuantileRange { level: 0.95 })
        );
        assert_eq!(
            parse_trace_band("iqr"),
            Ok(TraceInterval::QuantileRange { level: 0.5 })
        );
    }

    #[test]
    fn refuses_unknown_kinds_and_bad_levels() {
        for bad in [
            "whatever",
            "sd@0.9",
            "ci_normal@1",
            "ci_normal@x",
            "ci_t@0.95",
            "wsci_cm@0.95",
            "heuristic_se@0.95",
            "ci_normal",
            "quantile_range",
            "",
        ] {
            assert!(parse_trace_band(bad).is_err(), "{bad} should be refused");
        }
    }

    #[test]
    fn normal_quantile_matches_reference() {
        assert!((normal_quantile(0.975) - 1.959_963_984_540_054).abs() < 1e-8);
        assert!((normal_quantile(0.025) + 1.959_963_984_540_054).abs() < 1e-8);
        assert!((normal_quantile(0.995) - 2.575_829_303_548_901).abs() < 1e-8);
        assert!((normal_quantile(0.001) + 3.090_232_306_167_813).abs() < 1e-8);
        assert_eq!(normal_quantile(0.5), 0.0);
        assert!(normal_quantile(1.0).is_nan());
    }
}
