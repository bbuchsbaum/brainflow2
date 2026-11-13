export type AtlasStats = {
    total_layers: number;
    used_layers: number;
    free_layers: number;
    allocations: bigint;
    releases: bigint;
    high_watermark: number;
    full_events: bigint;
    is_3d: boolean;
    last_allocation_ms: bigint | null;
    last_release_ms: bigint | null;
    /**
     * Compatibility capacity for fixed-slot admission. In byte mode use
     * `residency_budget_bytes`; simultaneous draw sources stay bounded by
     * `draw_texture_capacity`.
     */
    volume_texture_slots: number;
    /**
     * Layers one frame draws at once. A per-view draw cap, not a residency
     * budget: uploads do not count against it, and a frame with more
     * visible layers leaves the extra ones out.
     */
    render_layer_capacity: number;
    /**
     * Admission policy: logical bytes, or the fixed-resident-count fallback.
     */
    residency_mode: 'bytes' | 'slots';
    /**
     * Logical volume and mask payloads; not physical VRAM usage.
     */
    resident_texture_bytes: number;
    residency_budget_bytes: number | null;
    free_residency_bytes: number | null;
    resident_texture_limit: number | null;
    /**
     * Distinct resident textures one draw can bind, independently of admission.
     */
    draw_texture_capacity: number;
    /**
     * Free fixed slots; zero (not applicable) in byte-budget mode.
     */
    free_texture_slots: number;
    /**
     * Volume texture slots holding data, including 4D resident-ring members.
     */
    resident_texture_slots: number;
    /**
     * Resident slots held by cached (not displayed) 4D ring members, which
     * admission can free without evicting a layer.
     */
    cached_image_slots: number;
    /**
     * Cumulative successful declarative GPU submissions for this renderer.
     */
    binding_frames: bigint;
    /**
     * Texture groups created during those frames (not intervening uploads).
     */
    binding_groups_created: bigint;
    /**
     * Frames that reused a current or cached texture group.
     */
    binding_cache_hits: bigint;
};
