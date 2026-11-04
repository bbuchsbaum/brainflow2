"""Independent numerical and fail-closed checks for the frozen campaign analysis."""

import copy
import math
import unittest

import numpy as np

from r3_performance_statistics import ENDPOINTS, interval, summarize_campaign


def fixture(overhead=0.0, control_overhead=0.0):
    sessions = []
    for group in range(24):
        for pair in range(6):
            control = pair == 5
            a = 100_000.0 + group * 100
            b = a * (1 + (control_overhead if control else overhead))
            sessions.append(
                {
                    "group": group,
                    "kind": "control" if control else "comparison",
                    "endpoints": {
                        endpoint: {"metrics": {"mean_ns": {"a": a, "b": b}}}
                        for endpoint in ENDPOINTS
                    },
                }
            )
    return sessions


class CampaignStatisticsTest(unittest.TestCase):
    def test_hac_matches_independent_covariance_matrix(self):
        x = np.array([3, 2, 4, 8, 9, 7, 2, 1] * 3, dtype=float)
        z = x - x.mean()
        result = interval(x.tolist(), 2)
        expected = {"ordinary": float(np.var(x, ddof=1) / len(x))}
        distance = np.abs(np.arange(24)[:, None] - np.arange(24)[None, :])
        for lag in (1, 2):
            weights = np.maximum(0, 1 - distance / (lag + 1))
            expected[f"hac_lag_{lag}"] = float(z @ weights @ z / (24 * 23))
        for name, value in expected.items():
            self.assertAlmostEqual(result["variance_estimates"][name], value, places=12)
        self.assertAlmostEqual(
            result["upper"], x.mean() + 2 * math.sqrt(max(expected.values()))
        )

    def test_positive_serial_dependence_increases_uncertainty(self):
        result = interval(list(range(24)), 2)
        self.assertGreater(
            result["variance_estimates"]["hac_lag_2"],
            result["variance_estimates"]["ordinary"],
        )

    def test_identical_versions_qualify_without_control_equivalence_gate(self):
        verdict = summarize_campaign(fixture())["verdict"]
        self.assertTrue(verdict["qualified"])

    def test_known_ten_percent_regression_cannot_qualify(self):
        verdict = summarize_campaign(fixture(0.1))["verdict"]
        self.assertFalse(verdict["all_primary_endpoints_pass"])
        self.assertFalse(verdict["qualified"])

    def test_strict_five_percent_boundary_does_not_pass(self):
        self.assertFalse(summarize_campaign(fixture(0.05))["verdict"]["qualified"])

    def test_systematic_control_asymmetry_blocks_good_candidate(self):
        verdict = summarize_campaign(fixture(-0.1, 0.2))["verdict"]
        self.assertTrue(verdict["all_primary_endpoints_pass"])
        self.assertTrue(verdict["control_falsification_detected"])
        self.assertFalse(verdict["qualified"])

    def test_swapping_control_labels_reverses_contrasts(self):
        data = fixture(0, 0.2)
        swapped = copy.deepcopy(data)
        for session in swapped:
            if session["kind"] == "control":
                for value in session["endpoints"].values():
                    means = value["metrics"]["mean_ns"]
                    means["a"], means["b"] = means["b"], means["a"]
        left = summarize_campaign(data)["summary"]["control"]
        right = summarize_campaign(swapped)["summary"]["control"]
        for endpoint in ENDPOINTS:
            for contrast in ("delta_ns", "symmetric_relative"):
                self.assertAlmostEqual(
                    left[endpoint][contrast]["mean"], -right[endpoint][contrast]["mean"]
                )

    def test_incomplete_misgrouped_or_invalid_campaign_rejected(self):
        for mutation in ("missing", "group", "nan", "zero", "endpoint"):
            with self.subTest(mutation=mutation):
                data = fixture()
                if mutation == "missing":
                    data.pop()
                elif mutation == "group":
                    data[0]["group"] = 1
                elif mutation == "endpoint":
                    data[0]["endpoints"].pop(ENDPOINTS[0])
                else:
                    data[0]["endpoints"][ENDPOINTS[0]]["metrics"]["mean_ns"]["a"] = (
                        math.nan if mutation == "nan" else 0
                    )
                with self.assertRaises(ValueError):
                    summarize_campaign(data)


if __name__ == "__main__":
    unittest.main()
