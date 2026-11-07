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

fn parse_backend_residency(value: Option<&str>) -> bool {
    value.is_some_and(|value| {
        matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "on"
        )
    })
}

/// Whether the backend owns admission and eviction (R5c): the
/// `BRAINFLOW_BACKEND_RESIDENCY` flag (`1`, `true` or `on`), read once.
pub(crate) fn backend_residency_enabled() -> bool {
    static ENABLED: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *ENABLED.get_or_init(|| {
        parse_backend_residency(std::env::var("BRAINFLOW_BACKEND_RESIDENCY").ok().as_deref())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backend_residency_flag_accepts_only_explicit_on_values() {
        for on in ["1", "true", "TRUE", " on "] {
            assert!(parse_backend_residency(Some(on)), "{on}");
        }
        for off in ["", "0", "false", "off", "yes", "2"] {
            assert!(!parse_backend_residency(Some(off)), "{off}");
        }
        assert!(!parse_backend_residency(None));
    }

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
