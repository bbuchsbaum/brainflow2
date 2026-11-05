//! Per-draw binding positions, independent of resident texture identities.
//! The bounded cache owns bind groups only; admission and eviction remain outside it.

use crate::{
    residency::{ResidentTextureStore, SlotHandle},
    RenderLoopError,
};
use std::{collections::VecDeque, sync::Arc};

const CACHE_CAPACITY: usize = 32;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct BindingPlan {
    pub(crate) handles: Vec<SlotHandle>,
    identity: bool,
}

impl BindingPlan {
    pub(crate) fn position(&self, resident_index: u32) -> Option<u32> {
        self.handles
            .iter()
            .position(|h| h.index() == resident_index)
            .map(|i| {
                if self.identity {
                    resident_index
                } else {
                    i as u32
                }
            })
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct BindingCacheStats {
    pub hits: u64,
    pub misses: u64,
    pub groups_created: u64,
    pub cached_groups: usize,
    /// Successful declarative GPU submissions, including normal image renders.
    pub frames: u64,
    /// Groups created inside those submissions (excludes uploads between frames).
    pub frame_groups_created: u64,
    pub frame_cache_hits: u64,
}

pub(crate) struct BindingPlanner {
    capacity: u32,
    revision: Option<(usize, u64)>,
    cache: VecDeque<(BindingPlan, Arc<wgpu::BindGroup>)>,
    stats: BindingCacheStats,
    #[cfg(test)]
    pub(crate) identity: bool,
}

impl BindingPlanner {
    pub(crate) fn new(capacity: u32) -> Self {
        Self {
            capacity,
            revision: None,
            cache: VecDeque::new(),
            stats: BindingCacheStats::default(),
            #[cfg(test)]
            identity: false,
        }
    }

    pub(crate) fn plan(
        &self,
        store: &ResidentTextureStore,
        indices: &[u32],
    ) -> Result<BindingPlan, RenderLoopError> {
        let mut handles = Vec::with_capacity(indices.len());
        for &index in indices {
            let handle = store
                .slot_handle(index)
                .ok_or_else(|| RenderLoopError::Internal {
                    code: 6020,
                    details: format!("Draw references nonresident texture {index}"),
                })?;
            if !handles.contains(&handle) {
                handles.push(handle);
            }
        }
        handles.sort_unstable_by_key(|h| h.index());
        if handles.len() > self.capacity as usize {
            return Err(RenderLoopError::Internal {
                code: 6021,
                details: format!(
                    "Draw needs {} textures; binding capacity is {}",
                    handles.len(),
                    self.capacity
                ),
            });
        }
        #[cfg(test)]
        let identity = self.identity;
        #[cfg(not(test))]
        let identity = false;
        Ok(BindingPlan { handles, identity })
    }

    pub(crate) fn lookup(
        &mut self,
        plan: &BindingPlan,
        store: &ResidentTextureStore,
    ) -> Option<Arc<wgpu::BindGroup>> {
        if self.revision != Some(store.binding_token()) {
            self.clear();
            self.revision = Some(store.binding_token());
        }
        // Generations and manager identity must still match even for a cache hit.
        if plan
            .handles
            .iter()
            .any(|h| store.slot_handle(h.index()) != Some(*h))
        {
            return None;
        }
        if let Some(index) = self.cache.iter().position(|(key, _)| key == plan) {
            let entry = self.cache.remove(index).expect("cache index exists");
            let group = entry.1.clone();
            self.cache.push_back(entry);
            self.stats.hits += 1;
            Some(group)
        } else {
            self.stats.misses += 1;
            None
        }
    }

    pub(crate) fn insert(&mut self, plan: BindingPlan, group: Arc<wgpu::BindGroup>) {
        if self.cache.len() == CACHE_CAPACITY {
            self.cache.pop_front();
        }
        self.cache.push_back((plan, group));
    }

    pub(crate) fn record_frame(&mut self, groups_created: u32, cache_hit: bool) {
        self.stats.frames += 1;
        self.stats.frame_groups_created += u64::from(groups_created);
        self.stats.frame_cache_hits += u64::from(cache_hit);
    }

    pub(crate) fn record_hit(&mut self) {
        self.stats.hits += 1;
    }

    pub(crate) fn record_group_created(&mut self) {
        self.stats.groups_created += 1;
    }

    pub(crate) fn clear(&mut self) {
        self.cache.clear();
    }

    pub(crate) fn stats(&self) -> BindingCacheStats {
        BindingCacheStats {
            cached_groups: self.cache.len(),
            ..self.stats
        }
    }

    #[cfg(test)]
    pub(crate) fn set_capacity_for_test(&mut self, capacity: u32) {
        self.capacity = capacity;
        self.clear();
    }
}
