"""Frozen analysis for the 24-group R3 qualification campaign.

Nominal inference uses Student-t(23) with the largest ordinary/Newey-West
(Bartlett lags 1 and 2) standard error. Short-lag HAC is an approximation,
not a guarantee against arbitrary long-range dependence.
"""

import math
import statistics

import scipy
from scipy.stats import t

ENDPOINTS = tuple(
    f"{mode}_{workload}"
    for mode in ("host", "completed")
    for workload in ("steady", "property_patch", "alternating_views")
)
N_GROUPS = 24


def analysis_specification():
    return {
        "groups": N_GROUPS,
        "comparison_pairs_per_group": 5,
        "control_pairs_per_group": 1,
        "replication_unit": "chronological group, not frames or pairs",
        "variance": "max(ordinary, Bartlett HAC lag 1, Bartlett HAC lag 2)",
        "variance_finite_sample_correction": "n/(n-1)",
        "degrees_of_freedom": N_GROUPS - 1,
        "candidate_one_sided_probability": 0.95,
        "candidate_t_critical": float(t.ppf(0.95, N_GROUPS - 1)),
        "control_familywise_alpha": 0.01,
        "control_test_count": 12,
        "control_t_critical": float(t.ppf(1 - 0.01 / 24, N_GROUPS - 1)),
        "candidate_required_bounds": {
            "delta_ns": 100_000,
            "relative": 0.05,
            "relative_margin_residual_ns": 0,
        },
        "control_contrasts": ["delta_ns", "symmetric_relative"],
        "control_effect_action": "inconclusive; never subtract control offsets",
        "scipy_version": scipy.__version__,
        "limitation": "nominal t/HAC inference, approximate under serial dependence",
    }


def interval(values, critical):
    """Return fixed-lag covariance estimates and the most conservative bound."""
    if len(values) != N_GROUPS or not all(math.isfinite(x) for x in values):
        raise ValueError("expected 24 finite chronological group contrasts")
    n = len(values)
    mean = statistics.mean(values)
    residuals = [x - mean for x in values]
    gamma = [
        sum(residuals[i] * residuals[i - lag] for i in range(lag, n)) / n
        for lag in range(3)
    ]
    variances = {"ordinary": gamma[0] / (n - 1)}
    for lag in (1, 2):
        long_run = gamma[0] + 2 * sum(
            (1 - k / (lag + 1)) * gamma[k] for k in range(1, lag + 1)
        )
        # Bartlett covariance is nonnegative; tolerate floating roundoff only.
        if long_run < -1e-12 * max(gamma[0], 1.0):
            raise ValueError("invalid negative Bartlett covariance")
        variances[f"hac_lag_{lag}"] = max(long_run, 0.0) / (n - 1)
    se = math.sqrt(max(variances.values()))
    return {
        "mean": mean,
        "standard_error": se,
        "variance_estimates": variances,
        "critical": critical,
        "lower": mean - critical * se,
        "upper": mean + critical * se,
        "group_contrasts": list(values),
    }


def _pair_values(session, endpoint):
    metric = session["endpoints"][endpoint]["metrics"]["mean_ns"]
    a, b = metric["a"], metric["b"]
    if not all(math.isfinite(x) and x > 0 for x in (a, b)):
        raise ValueError("positive finite baseline and candidate means required")
    return {
        "a": a,
        "b": b,
        "delta_ns": b - a,
        "relative": b / a - 1,
        "relative_margin_residual_ns": b - 1.05 * a,
        "symmetric_relative": 2 * (b - a) / (a + b),
    }


def summarize_campaign(sessions):
    """Analyze a complete campaign; partial/malformed data cannot qualify."""
    if len(sessions) != 144:
        raise ValueError("fixed campaign requires all 144 sessions")
    groups = {i: {"comparison": [], "control": []} for i in range(N_GROUPS)}
    previous_group = -1
    for session in sessions:
        group, kind = session["group"], session["kind"]
        if group not in groups or kind not in groups[group] or group < previous_group:
            raise ValueError("invalid chronological group/kind")
        if set(session["endpoints"]) != set(ENDPOINTS):
            raise ValueError("six complete endpoints required")
        groups[group][kind].append(session)
        previous_group = group
    if any(
        len(g["comparison"]) != 5 or len(g["control"]) != 1 for g in groups.values()
    ):
        raise ValueError("each group requires five comparisons and one control")

    spec = analysis_specification()
    summary = {"analysis": spec, "comparison": {}, "control": {}}
    endpoint_verdicts = {}
    flags = []
    for endpoint in ENDPOINTS:
        comparisons = [
            [_pair_values(s, endpoint) for s in groups[g]["comparison"]]
            for g in range(N_GROUPS)
        ]
        controls = [
            _pair_values(groups[g]["control"][0], endpoint) for g in range(N_GROUPS)
        ]
        checks = {}
        for contrast, limit in spec["candidate_required_bounds"].items():
            values = [
                statistics.mean(p[contrast] for p in pairs) for pairs in comparisons
            ]
            result = interval(values, spec["candidate_t_critical"])
            result.update(limit=limit, passes=result["upper"] < limit)
            checks[contrast] = result
        all_pairs = [p for group in comparisons for p in group]
        a = statistics.mean(p["a"] for p in all_pairs)
        b = statistics.mean(p["b"] for p in all_pairs)
        summary["comparison"][endpoint] = {
            "checks": checks,
            "baseline_mean_ns": a,
            "candidate_mean_ns": b,
            "ratio_of_grand_means_minus_one": b / a - 1,
        }
        endpoint_verdicts[endpoint] = all(x["passes"] for x in checks.values())
        control_checks = {}
        for contrast in spec["control_contrasts"]:
            result = interval(
                [p[contrast] for p in controls], spec["control_t_critical"]
            )
            result["false_effect_detected"] = result["lower"] > 0 or result["upper"] < 0
            if result["false_effect_detected"]:
                flags.append({"endpoint": endpoint, "contrast": contrast})
            control_checks[contrast] = result
        summary["control"][endpoint] = control_checks
    performance_pass = all(endpoint_verdicts.values())
    qualified = performance_pass and not flags
    return {
        "summary": summary,
        "verdict": {
            "qualified": qualified,
            "all_primary_endpoints_pass": performance_pass,
            "control_falsification_detected": bool(flags),
            "control_flags": flags,
            "endpoint_passes": endpoint_verdicts,
            "status": "qualified" if qualified else "inconclusive",
            "note": "Failure to qualify is not itself proof of a regression.",
        },
    }
