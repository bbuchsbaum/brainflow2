//! The stale-lease watchdog.

use crate::*;

const LAYER_WATCHDOG_INTERVAL: Duration = Duration::from_secs(60);
const LAYER_WATCHDOG_STALE_AGE: Duration = Duration::from_secs(5 * 60);

/// Payload of `layer-gpu-released` (camelCase for the UI).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LayerGpuReleasedEvent {
    layer_id: String,
    reason: String,
}

/// The watchdog's view of the bridge state.
pub(crate) struct WatchdogParts {
    leases: Arc<Mutex<HashMap<String, Arc<LayerLease>>>>,
    layer_map: Arc<Mutex<LayerSlotMap>>,
    layer_volumes: Arc<Mutex<HashMap<String, String>>>,
    volume_registry: Arc<Mutex<VolumeRegistry>>,
    render_loop_service: Arc<Mutex<Option<Arc<Mutex<RenderLoopService>>>>>,
    last_drawn: Arc<Mutex<HashMap<String, Instant>>>,
    residency: Arc<Residency>,
}

/// One watchdog pass: release leases that are stale and return their layer ids.
///
/// A lease is stale when its layer has no atlas mapping, or when it is older
/// than `stale_age` and no frame drew it within `stale_age`. Never released:
/// a layer the last frame drew, an editable label texture (an open
/// segmentation document's slot; releasing it behind the document loses its
/// claim, N34), and a layer of a volume an open document references (a
/// segmentation session's reference, secondary or frozen frame: its native
/// view draws it on demand, so a tab left behind for longer than the stale
/// age must not come back to a re-upload, QA r0 2026-11-02). Under a backend
/// owner (R5c) a layer any frame lists, drawn, held or pinned, is never
/// released either: the sweep only takes what no frame demands.
pub(crate) async fn layer_watchdog_sweep(
    parts: &WatchdogParts,
    stale_age: Duration,
) -> Vec<String> {
    let service_arc = {
        let guard = parts.render_loop_service.lock().await;
        guard.clone()
    };
    let Some(service_arc) = service_arc else {
        return Vec::new();
    };
    // The residencies the last frame drew and the editable ones, as handles:
    // a lease whose index was refilled by another upload is neither.
    let (active_slots, editable_slots): (HashSet<SlotHandle>, HashSet<SlotHandle>) = {
        let service = service_arc.lock().await;
        let active = service
            .active_atlas_indices()
            .into_iter()
            .filter_map(|index| service.slot_handle(index))
            .collect();
        let editable = service
            .multi_texture_manager
            .as_ref()
            .map(|manager| manager.resident_indices())
            .unwrap_or_default()
            .into_iter()
            .filter(|index| service.is_editable_volume_slot(*index))
            .filter_map(|index| service.slot_handle(index))
            .collect();
        (active, editable)
    };
    let layer_map_snapshot: LayerSlotMap = parts.layer_map.lock().await.clone();
    let layer_volumes_snapshot: HashMap<String, String> = parts.layer_volumes.lock().await.clone();
    let document_volumes: HashSet<String> = {
        let registry = parts.volume_registry.lock().await;
        registry
            .volumes
            .iter()
            .filter(|(_, entry)| entry.document_references > 0)
            .map(|(id, _)| id.clone())
            .collect()
    };
    let last_drawn_snapshot: HashMap<String, Instant> = parts.last_drawn.lock().await.clone();
    // Layer and volume ids some frame lists (R5c).
    let demanded: HashSet<String> = if parts.residency.backend_owner() {
        let residency = parts.residency.state.lock().await;
        residency
            .ledger
            .frames()
            .into_iter()
            .flat_map(|(_, demand)| demand.layers.iter().chain(&demand.held))
            .flat_map(|layer| [layer.layer_id.clone(), layer.volume_id.clone()])
            .collect()
    } else {
        HashSet::new()
    };
    let leases_snapshot: Vec<(String, Arc<LayerLease>)> = {
        let guard = parts.leases.lock().await;
        guard
            .iter()
            .map(|(layer_id, lease)| (layer_id.clone(), lease.clone()))
            .collect()
    };

    let mut to_remove = Vec::new();
    let mut released = Vec::new();
    for (layer_id, lease) in leases_snapshot {
        if lease.is_released() {
            to_remove.push(layer_id);
            continue;
        }
        let slot = lease.slot();
        if active_slots.contains(&slot) || editable_slots.contains(&slot) {
            continue;
        }
        if layer_volumes_snapshot
            .get(&layer_id)
            .is_some_and(|volume_id| document_volumes.contains(volume_id))
        {
            continue;
        }
        if demanded.contains(&layer_id)
            || layer_volumes_snapshot
                .get(&layer_id)
                .is_some_and(|volume_id| demanded.contains(volume_id))
        {
            continue;
        }
        let has_mapping = layer_map_snapshot.contains(&layer_id);
        let drawn_recently = last_drawn_snapshot
            .get(&layer_id)
            .is_some_and(|at| at.elapsed() < stale_age);
        if has_mapping && (lease.age() < stale_age || drawn_recently) {
            continue;
        }
        match lease.release("watchdog").await {
            Ok(_) => {
                info!(
                    "Layer watchdog released stale layer '{}' (atlas index {})",
                    layer_id,
                    slot.index()
                );
                to_remove.push(layer_id.clone());
                released.push(layer_id);
            }
            Err(err) => {
                warn!(
                    "Layer watchdog failed to release layer '{}': {:?}",
                    layer_id, err
                );
            }
        }
    }
    if !to_remove.is_empty() {
        let mut guard = parts.leases.lock().await;
        let mut last_drawn = parts.last_drawn.lock().await;
        for id in to_remove {
            guard.remove(&id);
            last_drawn.remove(&id);
        }
    }
    released
}

impl BridgeState {
    /// Start the stale-lease watchdog without telling anyone what it released
    /// (tests, headless use). The app uses [`Self::start_layer_watchdog_notifying`].
    pub fn start_layer_watchdog(&self) {
        self.start_layer_watchdog_with(Arc::new(|_released: Vec<String>| {}));
    }

    /// Start the watchdog and emit `layer-gpu-released` for every layer it
    /// releases, so the UI marks the layer non-resident and uploads it again
    /// when it is shown (instead of believing it is still resident).
    pub fn start_layer_watchdog_notifying<R: Runtime>(&self, app: tauri::AppHandle<R>) {
        self.start_layer_watchdog_with(Arc::new(move |released: Vec<String>| {
            for layer_id in released {
                let payload = LayerGpuReleasedEvent {
                    layer_id,
                    reason: "watchdog".into(),
                };
                if let Err(err) = app.emit("layer-gpu-released", &payload) {
                    warn!("Could not announce a watchdog release: {err:?}");
                }
            }
        }));
    }

    pub(crate) fn watchdog_parts(&self) -> WatchdogParts {
        WatchdogParts {
            leases: Arc::clone(&self.layer_leases),
            layer_map: Arc::clone(&self.layer_slots),
            layer_volumes: Arc::clone(&self.layer_to_volume_map),
            volume_registry: Arc::clone(&self.volume_registry),
            render_loop_service: Arc::clone(&self.render_loop_service),
            last_drawn: Arc::clone(&self.layer_last_drawn),
            residency: Arc::clone(&self.residency),
        }
    }

    pub(crate) fn start_layer_watchdog_with(
        &self,
        on_release: Arc<dyn Fn(Vec<String>) + Send + Sync>,
    ) {
        let parts = self.watchdog_parts();
        tauri::async_runtime::spawn(async move {
            let mut ticker = interval(LAYER_WATCHDOG_INTERVAL);
            ticker.set_missed_tick_behavior(MissedTickBehavior::Skip);
            loop {
                ticker.tick().await;
                let released = layer_watchdog_sweep(&parts, LAYER_WATCHDOG_STALE_AGE).await;
                if !released.is_empty() {
                    on_release(released);
                }
            }
        });
    }
}
