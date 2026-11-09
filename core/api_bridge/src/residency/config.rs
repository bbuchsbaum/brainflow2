//! Application policy for logical resident texture payloads, not detected VRAM.
use bridge_types::{BridgeError, BridgeResult};
use render_loop::{RendererResidencyConfig, DEFAULT_RESIDENCY_BYTE_BUDGET as DEFAULT_BUDGET_BYTES};

const MAX_JSON_INTEGER: u64 = 9_007_199_254_740_991;

fn parse_budget(value: Option<&str>) -> BridgeResult<RendererResidencyConfig> {
    let invalid = || {
        BridgeError::Input {
        code: 6009,
        details: "BRAINFLOW_GPU_RESIDENCY_BUDGET_BYTES must be an integer from 0 through 9007199254740991; 0 selects the fixed-slot fallback".into(),
    }
    };
    let bytes = match value {
        None => DEFAULT_BUDGET_BYTES,
        Some(value) => value.trim().parse::<u64>().map_err(|_| invalid())?,
    };
    if bytes > MAX_JSON_INTEGER {
        return Err(invalid());
    }
    Ok(if bytes == 0 {
        RendererResidencyConfig::FixedSlots
    } else {
        RendererResidencyConfig::ByteBudget {
            budget_bytes: bytes,
        }
    })
}

pub(crate) fn application_residency_config() -> BridgeResult<RendererResidencyConfig> {
    match std::env::var("BRAINFLOW_GPU_RESIDENCY_BUDGET_BYTES") {
        Ok(value) => parse_budget(Some(&value)),
        Err(std::env::VarError::NotPresent) => parse_budget(None),
        Err(std::env::VarError::NotUnicode(_)) => Err(BridgeError::Input {
            code: 6009,
            details: "BRAINFLOW_GPU_RESIDENCY_BUDGET_BYTES is not valid Unicode".into(),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_and_explicit_fallback_are_separate_from_draw_capacity() {
        assert!(matches!(
            parse_budget(None).unwrap(),
            RendererResidencyConfig::ByteBudget {
                budget_bytes: DEFAULT_BUDGET_BYTES
            }
        ));
        assert!(matches!(
            parse_budget(Some("0")).unwrap(),
            RendererResidencyConfig::FixedSlots
        ));
        assert!(matches!(
            parse_budget(Some(" 1024 ")).unwrap(),
            RendererResidencyConfig::ByteBudget { budget_bytes: 1024 }
        ));
    }

    #[test]
    fn malformed_and_unrepresentable_budgets_are_refused() {
        for value in [
            "",
            "-1",
            "NaN",
            "1.5",
            "512MiB",
            "9007199254740992",
            "18446744073709551616",
        ] {
            assert!(parse_budget(Some(value)).is_err(), "{value}");
        }
    }
}
