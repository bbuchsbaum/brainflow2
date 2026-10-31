//! First-party bridge modules: descriptors, lifecycle hooks, typed state slots and
//! the runtime enable gate.
//!
//! A module is compiled in and always registered. Its commands are listed under
//! `module <id> { ... }` in `command_list.rs`, defined in `modules/<id>.rs` (the
//! adapter) and granted through the generated `module-<id>` permission set, so
//! bindings and permissions never depend on runtime state. Runtime enablement is
//! enforced here instead: every module command starts with [`ModuleHost::enter`],
//! which rejects with `BridgeError::ModuleDisabled` while the module is off.
//!
//! Ownership and lock order:
//! - The slot map is filled once while `BridgeState` is constructed and is
//!   read-only afterwards, so it needs no lock. Each module state owns its own
//!   interior locks.
//! - The gate (`ModuleHost::enabled`) is taken before any module state lock.
//!   Module commands hold a read guard for their whole body; [`ModuleHost::set_enabled`]
//!   takes the write guard. A module is therefore never switched off while one of
//!   its commands runs, and its `on_disable` hook finishes before a later command
//!   can enter. A command must enter the gate at most once, and `on_disable` must
//!   not enter it at all.

use crate::BridgeState;
use async_trait::async_trait;
use bridge_types::{BridgeError, BridgeResult};
use log::info;
use serde::Serialize;
use std::any::{type_name, Any, TypeId};
use std::collections::{BTreeSet, HashMap};
use std::sync::Arc;
use tauri::{command, State};
use tokio::sync::{RwLock, RwLockReadGuard};
use ts_rs::TS;

pub(crate) mod analysis;

/// Every compiled-in module, in registration order. Each entry needs a matching
/// `module <id> { ... }` section in `command_list.rs` (asserted by a test).
pub(crate) static REGISTERED_MODULES: &[&dyn BridgeModule] = &[&analysis::MODULE];

/// `BridgeError::ModuleDisabled`: a module command was called while it is off.
pub const MODULE_DISABLED_CODE: u16 = 12001;
/// `BridgeError::Input`: `set_enabled_modules` named an unregistered module.
const UNKNOWN_MODULE_CODE: u16 = 12002;
/// `BridgeError::Internal`: a module command asked for a state slot that was
/// never registered (a programming error).
const MISSING_STATE_CODE: u16 = 12003;

/// Maturity stage of a module (see `docs/plans/module-architecture.md`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum ModuleStage {
    Experimental,
    Preview,
    Stable,
}

/// Static identity of a bridge module.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub struct ModuleDescriptor {
    /// Module id; matches the `module <id>` section in `command_list.rs`.
    pub id: &'static str,
    pub title: &'static str,
    pub version: &'static str,
    pub stage: ModuleStage,
}

/// A module descriptor plus its current runtime state, as returned by
/// `list_modules` and `set_enabled_modules`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub struct ModuleInfo {
    #[serde(flatten)]
    #[ts(flatten)]
    pub descriptor: ModuleDescriptor,
    pub enabled: bool,
}

/// Bridge side of a first-party module. Implemented by the adapter in
/// `modules/<id>.rs`; domain logic belongs in the transport-neutral crate.
///
/// Hooks have no-op defaults. Add a new hook only together with the core code
/// that calls it.
#[async_trait]
pub trait BridgeModule: Send + Sync + 'static {
    fn descriptor(&self) -> &'static ModuleDescriptor;

    /// Insert this module's state into the slot map. Called once while
    /// `BridgeState` is constructed.
    fn register_state(&self, _slots: &mut ModuleSlots) {}

    /// Called once when the module is switched off at runtime. Reclaim what the
    /// module owns (running jobs, GPU leases, layers, provider sessions). Runs
    /// under the gate's write guard, so it must not call module commands.
    async fn on_disable(&self, _ctx: &ModuleCtx<'_>) {}
}

/// What a lifecycle hook may touch: the module state slots, not `BridgeState`.
pub struct ModuleCtx<'a> {
    slots: &'a ModuleSlots,
}

impl ModuleCtx<'_> {
    pub fn state<T: Any + Send + Sync>(&self) -> Option<Arc<T>> {
        self.slots.get::<T>()
    }
}

/// Typed map of module states, one value per Rust type.
#[derive(Default)]
pub struct ModuleSlots {
    slots: HashMap<TypeId, Arc<dyn Any + Send + Sync>>,
}

impl ModuleSlots {
    /// Register a module's state. Panics if a value of this type is already
    /// registered: two modules must not share a state type.
    pub fn insert<T: Any + Send + Sync>(&mut self, state: T) {
        let previous = self.slots.insert(TypeId::of::<T>(), Arc::new(state));
        assert!(
            previous.is_none(),
            "module state slot {} registered twice",
            type_name::<T>()
        );
    }

    pub fn get<T: Any + Send + Sync>(&self) -> Option<Arc<T>> {
        let slot = Arc::clone(self.slots.get(&TypeId::of::<T>())?);
        slot.downcast::<T>().ok()
    }
}

/// A module state borrowed through the enable gate. Holding it keeps the module
/// enabled; drop it when the command finishes.
pub(crate) struct ActiveModule<'a, T> {
    state: Arc<T>,
    _gate: RwLockReadGuard<'a, BTreeSet<&'static str>>,
}

impl<T> std::ops::Deref for ActiveModule<'_, T> {
    type Target = T;

    fn deref(&self) -> &T {
        &self.state
    }
}

/// Registered modules, their state slots and the runtime enable gate. One field
/// on `BridgeState`.
pub struct ModuleHost {
    modules: &'static [&'static dyn BridgeModule],
    slots: ModuleSlots,
    enabled: RwLock<BTreeSet<&'static str>>,
}

impl ModuleHost {
    /// Register `modules` and their state. Every module starts enabled; the UI
    /// applies the user's choice through `set_enabled_modules`.
    pub(crate) fn new(modules: &'static [&'static dyn BridgeModule]) -> Self {
        let mut slots = ModuleSlots::default();
        let mut ids = BTreeSet::new();
        for module in modules {
            let id = module.descriptor().id;
            assert!(ids.insert(id), "bridge module '{id}' registered twice");
            module.register_state(&mut slots);
        }
        Self {
            modules,
            slots,
            enabled: RwLock::new(ids),
        }
    }

    /// Enter a module command: reject while `module_id` is disabled, otherwise
    /// return its state slot. Keep the returned guard for the whole command.
    pub(crate) async fn enter<T: Any + Send + Sync>(
        &self,
        module_id: &'static str,
    ) -> BridgeResult<ActiveModule<'_, T>> {
        let gate = self.enabled.read().await;
        if !gate.contains(module_id) {
            return Err(BridgeError::ModuleDisabled {
                code: MODULE_DISABLED_CODE,
                module: module_id.to_string(),
            });
        }
        let state = self.slots.get::<T>().ok_or_else(|| BridgeError::Internal {
            code: MISSING_STATE_CODE,
            details: format!(
                "Module '{module_id}' has no {} state slot",
                type_name::<T>()
            ),
        })?;
        Ok(ActiveModule { state, _gate: gate })
    }

    /// Ungated slot lookup, for tests and core teardown. Commands use [`Self::enter`].
    #[allow(dead_code)]
    pub(crate) fn state<T: Any + Send + Sync>(&self) -> Option<Arc<T>> {
        self.slots.get::<T>()
    }

    pub async fn list(&self) -> Vec<ModuleInfo> {
        let enabled = self.enabled.read().await;
        self.infos(&enabled)
    }

    /// Make exactly `module_ids` enabled. Unknown ids are rejected before any
    /// change. Modules switched off by this call run `on_disable` once, before
    /// any later command can enter them.
    pub async fn set_enabled(&self, module_ids: &[String]) -> BridgeResult<Vec<ModuleInfo>> {
        let mut requested = BTreeSet::new();
        for id in module_ids {
            let module = self
                .modules
                .iter()
                .find(|module| module.descriptor().id == id.as_str())
                .ok_or_else(|| BridgeError::Input {
                    code: UNKNOWN_MODULE_CODE,
                    details: format!(
                        "Unknown module id '{id}'. Registered modules: {}",
                        self.ids().collect::<Vec<_>>().join(", ")
                    ),
                })?;
            requested.insert(module.descriptor().id);
        }

        // Waits for in-flight module commands; later commands wait for the hooks.
        let mut enabled = self.enabled.write().await;
        let switched_off: Vec<&dyn BridgeModule> = self
            .modules
            .iter()
            .copied()
            .filter(|module| {
                let id = module.descriptor().id;
                enabled.contains(id) && !requested.contains(id)
            })
            .collect();
        *enabled = requested;

        let ctx = ModuleCtx { slots: &self.slots };
        for module in switched_off {
            info!("Disabling bridge module '{}'", module.descriptor().id);
            module.on_disable(&ctx).await;
        }
        Ok(self.infos(&enabled))
    }

    fn ids(&self) -> impl Iterator<Item = &'static str> + '_ {
        self.modules.iter().map(|module| module.descriptor().id)
    }

    fn infos(&self, enabled: &BTreeSet<&'static str>) -> Vec<ModuleInfo> {
        self.modules
            .iter()
            .map(|module| {
                let descriptor = *module.descriptor();
                ModuleInfo {
                    enabled: enabled.contains(descriptor.id),
                    descriptor,
                }
            })
            .collect()
    }
}

/// Descriptors of every compiled-in module, in registration order. Used by the
/// TypeScript export.
pub fn module_descriptors() -> Vec<ModuleDescriptor> {
    REGISTERED_MODULES
        .iter()
        .map(|module| *module.descriptor())
        .collect()
}

// --- Core commands ---

/// List the compiled-in modules and whether each is enabled.
#[command]
#[tracing::instrument(skip_all, err, name = "api.list_modules")]
pub async fn list_modules(state: State<'_, BridgeState>) -> BridgeResult<Vec<ModuleInfo>> {
    Ok(state.modules.list().await)
}

/// Enable exactly `module_ids` and disable every other module. Returns the new
/// module list. Disabled modules reclaim their resources and their commands
/// reject with `ModuleDisabled` until they are enabled again.
#[command]
#[tracing::instrument(skip_all, err, name = "api.set_enabled_modules")]
pub async fn set_enabled_modules(
    module_ids: Vec<String>,
    state: State<'_, BridgeState>,
) -> BridgeResult<Vec<ModuleInfo>> {
    state.modules.set_enabled(&module_ids).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    struct ProbeState {
        disabled: AtomicUsize,
    }

    struct ProbeModule(&'static ModuleDescriptor);

    #[async_trait]
    impl BridgeModule for ProbeModule {
        fn descriptor(&self) -> &'static ModuleDescriptor {
            self.0
        }

        fn register_state(&self, slots: &mut ModuleSlots) {
            if self.0.id == "probe" {
                slots.insert(ProbeState {
                    disabled: AtomicUsize::new(0),
                });
            }
        }

        async fn on_disable(&self, ctx: &ModuleCtx<'_>) {
            // Only `probe` owns `ProbeState`; `other` has no state to reclaim.
            if self.0.id != "probe" {
                return;
            }
            if let Some(state) = ctx.state::<ProbeState>() {
                state.disabled.fetch_add(1, Ordering::SeqCst);
            }
        }
    }

    static PROBE: ProbeModule = ProbeModule(&ModuleDescriptor {
        id: "probe",
        title: "Probe",
        version: "0.0.1",
        stage: ModuleStage::Experimental,
    });
    static OTHER: ProbeModule = ProbeModule(&ModuleDescriptor {
        id: "other",
        title: "Other",
        version: "0.0.1",
        stage: ModuleStage::Stable,
    });
    static PROBE_MODULES: &[&dyn BridgeModule] = &[&PROBE, &OTHER];

    fn disabled_count(host: &ModuleHost) -> usize {
        host.state::<ProbeState>()
            .expect("probe state")
            .disabled
            .load(Ordering::SeqCst)
    }

    fn enabled_ids(infos: &[ModuleInfo]) -> Vec<&'static str> {
        infos
            .iter()
            .filter(|info| info.enabled)
            .map(|info| info.descriptor.id)
            .collect()
    }

    #[test]
    fn slots_are_typed() {
        let mut slots = ModuleSlots::default();
        slots.insert(7_u32);
        slots.insert(String::from("seven"));
        assert_eq!(*slots.get::<u32>().expect("u32 slot"), 7);
        assert_eq!(
            slots.get::<String>().expect("string slot").as_str(),
            "seven"
        );
        assert!(slots.get::<u64>().is_none());
    }

    #[test]
    #[should_panic(expected = "registered twice")]
    fn slots_reject_a_second_value_of_one_type() {
        let mut slots = ModuleSlots::default();
        slots.insert(1_u8);
        slots.insert(2_u8);
    }

    #[tokio::test]
    async fn modules_start_enabled_and_gate_rejects_when_disabled() {
        let host = ModuleHost::new(PROBE_MODULES);
        assert_eq!(enabled_ids(&host.list().await), vec!["probe", "other"]);
        assert!(host.enter::<ProbeState>("probe").await.is_ok());

        let infos = host
            .set_enabled(&["other".to_string()])
            .await
            .expect("disable probe");
        assert_eq!(enabled_ids(&infos), vec!["other"]);
        assert_eq!(disabled_count(&host), 1);

        match host.enter::<ProbeState>("probe").await {
            Err(BridgeError::ModuleDisabled { code, module }) => {
                assert_eq!(code, MODULE_DISABLED_CODE);
                assert_eq!(module, "probe");
            }
            Err(other) => panic!("expected ModuleDisabled, got {other:?}"),
            Ok(_) => panic!("expected ModuleDisabled, got an active module"),
        }

        // Disabling an already-disabled module does not run the hook again.
        host.set_enabled(&["other".to_string()])
            .await
            .expect("still disabled");
        assert_eq!(disabled_count(&host), 1);

        // Re-enabling restores access without running `on_disable`.
        host.set_enabled(&["probe".to_string(), "other".to_string()])
            .await
            .expect("re-enable");
        assert!(host.enter::<ProbeState>("probe").await.is_ok());
        assert_eq!(disabled_count(&host), 1);
    }

    #[tokio::test]
    async fn unknown_module_ids_are_rejected_without_changes() {
        let host = ModuleHost::new(PROBE_MODULES);
        let err = host
            .set_enabled(&["other".to_string(), "nope".to_string()])
            .await
            .expect_err("unknown id");
        match err {
            BridgeError::Input { code, details } => {
                assert_eq!(code, UNKNOWN_MODULE_CODE);
                assert!(details.contains("'nope'"), "{details}");
                assert!(details.contains("probe, other"), "{details}");
            }
            other => panic!("expected Input error, got {other:?}"),
        }
        assert_eq!(enabled_ids(&host.list().await), vec!["probe", "other"]);
        assert_eq!(disabled_count(&host), 0);
    }

    #[tokio::test]
    async fn missing_state_slot_is_an_internal_error() {
        let host = ModuleHost::new(PROBE_MODULES);
        let entered = host.enter::<u64>("other").await;
        match entered {
            Err(BridgeError::Internal { code, .. }) => assert_eq!(code, MISSING_STATE_CODE),
            Err(other) => panic!("expected Internal error, got {other:?}"),
            Ok(_) => panic!("expected Internal error, got an active module"),
        }
    }

    #[tokio::test]
    async fn disabling_waits_for_in_flight_module_commands() {
        let host = Arc::new(ModuleHost::new(PROBE_MODULES));
        let active = host.enter::<ProbeState>("probe").await.expect("enter");

        let disabler = tokio::spawn({
            let host = Arc::clone(&host);
            async move { host.set_enabled(&[]).await }
        });
        for _ in 0..10 {
            tokio::task::yield_now().await;
        }
        assert_eq!(disabled_count(&host), 0, "hook waits for the command");
        assert!(!disabler.is_finished());

        drop(active);
        let infos = disabler.await.expect("join").expect("disable all");
        assert!(enabled_ids(&infos).is_empty());
        assert_eq!(disabled_count(&host), 1);
    }

    #[test]
    fn module_disabled_error_serializes_with_the_module_id() {
        let err = BridgeError::ModuleDisabled {
            code: MODULE_DISABLED_CODE,
            module: "analysis".to_string(),
        };
        assert_eq!(
            serde_json::to_value(&err).expect("serialize"),
            serde_json::json!({ "ModuleDisabled": { "code": 12001, "module": "analysis" } })
        );
        assert_eq!(err.to_string(), "Module 'analysis' is disabled");
    }

    #[test]
    fn module_info_serializes_flat() {
        let info = ModuleInfo {
            descriptor: *PROBE.descriptor(),
            enabled: false,
        };
        assert_eq!(
            serde_json::to_value(&info).expect("serialize"),
            serde_json::json!({
                "id": "probe",
                "title": "Probe",
                "version": "0.0.1",
                "stage": "experimental",
                "enabled": false,
            })
        );
    }

    #[test]
    fn every_module_section_has_one_registered_module() {
        let sections: Vec<&str> = crate::MODULE_COMMANDS.iter().map(|(id, _)| *id).collect();
        let registered: Vec<&str> = module_descriptors().iter().map(|d| d.id).collect();
        assert_eq!(
            sections, registered,
            "`module <id>` sections in command_list.rs must match REGISTERED_MODULES (same order)"
        );
    }
}
