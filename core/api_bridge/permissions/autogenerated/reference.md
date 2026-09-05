## Default Permission

Default permissions for api-bridge plugin

#### This default permission set includes the following:

- `allow-cancel-remote-file-load`
- `allow-load-file`
- `allow-load-surface`
- `allow-unload-surface`
- `allow-unload-surface-overlay`
- `allow-unload-volume`
- `allow-get-surface-geometry`
- `allow-get-volume-bounds`
- `allow-get-initial-views`
- `allow-recalculate-view-for-dimensions`
- `allow-recalculate-all-views`
- `allow-request-layer-gpu-resources`
- `allow-wait-for-layer-ready`
- `allow-release-layer-gpu-resources`
- `allow-fs-list-directory`
- `allow-list-remote-mounts`
- `allow-list-remote-directory`
- `allow-init-render-loop`
- `allow-resize-canvas`
- `allow-update-frame-ubo`
- `allow-update-frame-for-synchronized-view`
- `allow-set-crosshair`
- `allow-update-slice-outline`
- `allow-create-offscreen-render-target`
- `allow-add-render-layer`
- `allow-request-frame`
- `allow-clear-render-layers`
- `allow-patch-layer`
- `allow-compute-layer-histogram`
- `allow-update-layer-opacity`
- `allow-update-layer-colormap`
- `allow-update-layer-intensity`
- `allow-update-layer-threshold`
- `allow-sample-world-coordinate`
- `allow-sample-layer-value-at-world`
- `allow-get-volume-for-projection`
- `allow-project-volume-to-surface`
- `allow-create-surface-sampler`
- `allow-apply-sampler`
- `allow-release-sampler`
- `allow-query-slice-axis-meta`
- `allow-batch-render-slices`
- `allow-get-atlas-catalog`
- `allow-get-filtered-atlases`
- `allow-get-atlas-entry`
- `allow-toggle-atlas-favorite`
- `allow-get-recent-atlases`
- `allow-get-favorite-atlases`
- `allow-validate-atlas-config`
- `allow-load-atlas`
- `allow-get-atlas-roi-locations`
- `allow-preview-surface-parcel-table`
- `allow-bind-surface-parcel-table`
- `allow-preview-parcel-table`
- `allow-create-parcel-overlay`
- `allow-select-parcel-column`
- `allow-get-atlas-palette`
- `allow-register-categorical-colormap`
- `allow-get-atlas-stats`
- `allow-start-atlas-progress-monitoring`
- `allow-get-atlas-subscription-count`
- `allow-set-volume-timepoint`
- `allow-get-volume-timepoint`
- `allow-get-volume-info`
- `allow-get-nifti-header-info`
- `allow-peek-volume-metadata`
- `allow-render-view`
- `allow-submit-view`
- `allow-render-views`
- `allow-get-template-catalog`
- `allow-get-filtered-templates`
- `allow-get-template-entry`
- `allow-validate-template-config`
- `allow-load-template`
- `allow-load-template-by-id`
- `allow-get-template-cache-stats`
- `allow-clear-template-cache`
- `allow-load-surface-template`
- `allow-get-surface-template-catalog`
- `allow-load-surface-atlas`
- `allow-load-surface-overlay`
- `allow-get-surface-overlay-data`
- `allow-set-layer-mask`
- `allow-set-layer-border`
- `allow-list-analyses`
- `allow-start-analysis`
- `allow-cancel-analysis`
- `allow-get-analysis-job-status`
- `allow-preview-folder-ontology`
- `allow-preview-set-studio-imports`
- `allow-promote-discovery-to-neurotabs`
- `allow-materialize-set-studio-compare-panes`
- `allow-start-set-studio-compare-materialization`
- `allow-get-set-studio-materialization-status`
- `allow-cancel-set-studio-materialization`
- `allow-check-bids-directory`
- `allow-scan-bids-dataset`
- `allow-get-bids-events`
- `allow-sample-voxel-timeseries`
- `allow-sample-stack`
- `allow-compute-temporal-metric`
- `allow-compute-region-stats`
- `allow-sample-set-at-world`
- `allow-sample-set-trace-at-world`

## Permission Table

<table>
<tr>
<th>Identifier</th>
<th>Description</th>
</tr>


<tr>
<td>

`api-bridge:allow-add-render-layer`

</td>
<td>

Enables the add_render_layer command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-add-render-layer`

</td>
<td>

Denies the add_render_layer command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-apply-sampler`

</td>
<td>

Enables the apply_sampler command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-apply-sampler`

</td>
<td>

Denies the apply_sampler command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-batch-render-slices`

</td>
<td>

Enables the batch_render_slices command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-batch-render-slices`

</td>
<td>

Denies the batch_render_slices command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-bind-surface-parcel-table`

</td>
<td>

Enables the bind_surface_parcel_table command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-bind-surface-parcel-table`

</td>
<td>

Denies the bind_surface_parcel_table command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-cancel-analysis`

</td>
<td>

Enables the cancel_analysis command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-cancel-analysis`

</td>
<td>

Denies the cancel_analysis command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-cancel-remote-file-load`

</td>
<td>

Enables the cancel_remote_file_load command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-cancel-remote-file-load`

</td>
<td>

Denies the cancel_remote_file_load command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-cancel-set-studio-materialization`

</td>
<td>

Enables the cancel_set_studio_materialization command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-cancel-set-studio-materialization`

</td>
<td>

Denies the cancel_set_studio_materialization command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-check-bids-directory`

</td>
<td>

Enables the check_bids_directory command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-check-bids-directory`

</td>
<td>

Denies the check_bids_directory command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-clear-render-layers`

</td>
<td>

Enables the clear_render_layers command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-clear-render-layers`

</td>
<td>

Denies the clear_render_layers command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-clear-template-cache`

</td>
<td>

Enables the clear_template_cache command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-clear-template-cache`

</td>
<td>

Denies the clear_template_cache command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-compute-layer-histogram`

</td>
<td>

Enables the compute_layer_histogram command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-compute-layer-histogram`

</td>
<td>

Denies the compute_layer_histogram command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-compute-region-stats`

</td>
<td>

Enables the compute_region_stats command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-compute-region-stats`

</td>
<td>

Denies the compute_region_stats command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-compute-temporal-metric`

</td>
<td>

Enables the compute_temporal_metric command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-compute-temporal-metric`

</td>
<td>

Denies the compute_temporal_metric command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-create-offscreen-render-target`

</td>
<td>

Enables the create_offscreen_render_target command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-create-offscreen-render-target`

</td>
<td>

Denies the create_offscreen_render_target command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-create-parcel-overlay`

</td>
<td>

Enables the create_parcel_overlay command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-create-parcel-overlay`

</td>
<td>

Denies the create_parcel_overlay command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-create-surface-sampler`

</td>
<td>

Enables the create_surface_sampler command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-create-surface-sampler`

</td>
<td>

Denies the create_surface_sampler command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-fs-list-directory`

</td>
<td>

Enables the fs_list_directory command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-fs-list-directory`

</td>
<td>

Denies the fs_list_directory command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-get-analysis-job-status`

</td>
<td>

Enables the get_analysis_job_status command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-get-analysis-job-status`

</td>
<td>

Denies the get_analysis_job_status command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-get-atlas-catalog`

</td>
<td>

Enables the get_atlas_catalog command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-get-atlas-catalog`

</td>
<td>

Denies the get_atlas_catalog command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-get-atlas-entry`

</td>
<td>

Enables the get_atlas_entry command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-get-atlas-entry`

</td>
<td>

Denies the get_atlas_entry command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-get-atlas-palette`

</td>
<td>

Enables the get_atlas_palette command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-get-atlas-palette`

</td>
<td>

Denies the get_atlas_palette command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-get-atlas-roi-locations`

</td>
<td>

Enables the get_atlas_roi_locations command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-get-atlas-roi-locations`

</td>
<td>

Denies the get_atlas_roi_locations command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-get-atlas-stats`

</td>
<td>

Enables the get_atlas_stats command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-get-atlas-stats`

</td>
<td>

Denies the get_atlas_stats command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-get-atlas-subscription-count`

</td>
<td>

Enables the get_atlas_subscription_count command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-get-atlas-subscription-count`

</td>
<td>

Denies the get_atlas_subscription_count command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-get-bids-events`

</td>
<td>

Enables the get_bids_events command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-get-bids-events`

</td>
<td>

Denies the get_bids_events command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-get-favorite-atlases`

</td>
<td>

Enables the get_favorite_atlases command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-get-favorite-atlases`

</td>
<td>

Denies the get_favorite_atlases command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-get-filtered-atlases`

</td>
<td>

Enables the get_filtered_atlases command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-get-filtered-atlases`

</td>
<td>

Denies the get_filtered_atlases command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-get-filtered-templates`

</td>
<td>

Enables the get_filtered_templates command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-get-filtered-templates`

</td>
<td>

Denies the get_filtered_templates command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-get-initial-views`

</td>
<td>

Enables the get_initial_views command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-get-initial-views`

</td>
<td>

Denies the get_initial_views command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-get-nifti-header-info`

</td>
<td>

Enables the get_nifti_header_info command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-get-nifti-header-info`

</td>
<td>

Denies the get_nifti_header_info command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-get-recent-atlases`

</td>
<td>

Enables the get_recent_atlases command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-get-recent-atlases`

</td>
<td>

Denies the get_recent_atlases command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-get-set-studio-materialization-status`

</td>
<td>

Enables the get_set_studio_materialization_status command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-get-set-studio-materialization-status`

</td>
<td>

Denies the get_set_studio_materialization_status command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-get-surface-geometry`

</td>
<td>

Enables the get_surface_geometry command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-get-surface-geometry`

</td>
<td>

Denies the get_surface_geometry command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-get-surface-overlay-data`

</td>
<td>

Enables the get_surface_overlay_data command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-get-surface-overlay-data`

</td>
<td>

Denies the get_surface_overlay_data command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-get-surface-template-catalog`

</td>
<td>

Enables the get_surface_template_catalog command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-get-surface-template-catalog`

</td>
<td>

Denies the get_surface_template_catalog command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-get-template-cache-stats`

</td>
<td>

Enables the get_template_cache_stats command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-get-template-cache-stats`

</td>
<td>

Denies the get_template_cache_stats command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-get-template-catalog`

</td>
<td>

Enables the get_template_catalog command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-get-template-catalog`

</td>
<td>

Denies the get_template_catalog command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-get-template-entry`

</td>
<td>

Enables the get_template_entry command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-get-template-entry`

</td>
<td>

Denies the get_template_entry command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-get-volume-bounds`

</td>
<td>

Enables the get_volume_bounds command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-get-volume-bounds`

</td>
<td>

Denies the get_volume_bounds command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-get-volume-for-projection`

</td>
<td>

Enables the get_volume_for_projection command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-get-volume-for-projection`

</td>
<td>

Denies the get_volume_for_projection command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-get-volume-info`

</td>
<td>

Enables the get_volume_info command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-get-volume-info`

</td>
<td>

Denies the get_volume_info command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-get-volume-timepoint`

</td>
<td>

Enables the get_volume_timepoint command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-get-volume-timepoint`

</td>
<td>

Denies the get_volume_timepoint command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-init-render-loop`

</td>
<td>

Enables the init_render_loop command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-init-render-loop`

</td>
<td>

Denies the init_render_loop command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-list-analyses`

</td>
<td>

Enables the list_analyses command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-list-analyses`

</td>
<td>

Denies the list_analyses command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-list-remote-directory`

</td>
<td>

Enables the list_remote_directory command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-list-remote-directory`

</td>
<td>

Denies the list_remote_directory command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-list-remote-mount-profiles`

</td>
<td>

Enables the list_remote_mount_profiles command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-list-remote-mount-profiles`

</td>
<td>

Denies the list_remote_mount_profiles command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-list-remote-mounts`

</td>
<td>

Enables the list_remote_mounts command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-list-remote-mounts`

</td>
<td>

Denies the list_remote_mounts command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-load-atlas`

</td>
<td>

Enables the load_atlas command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-load-atlas`

</td>
<td>

Denies the load_atlas command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-load-file`

</td>
<td>

Enables the load_file command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-load-file`

</td>
<td>

Denies the load_file command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-load-surface`

</td>
<td>

Enables the load_surface command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-load-surface`

</td>
<td>

Denies the load_surface command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-load-surface-atlas`

</td>
<td>

Enables the load_surface_atlas command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-load-surface-atlas`

</td>
<td>

Denies the load_surface_atlas command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-load-surface-overlay`

</td>
<td>

Enables the load_surface_overlay command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-load-surface-overlay`

</td>
<td>

Denies the load_surface_overlay command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-load-surface-template`

</td>
<td>

Enables the load_surface_template command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-load-surface-template`

</td>
<td>

Denies the load_surface_template command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-load-template`

</td>
<td>

Enables the load_template command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-load-template`

</td>
<td>

Denies the load_template command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-load-template-by-id`

</td>
<td>

Enables the load_template_by_id command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-load-template-by-id`

</td>
<td>

Denies the load_template_by_id command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-materialize-set-studio-compare-panes`

</td>
<td>

Enables the materialize_set_studio_compare_panes command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-materialize-set-studio-compare-panes`

</td>
<td>

Denies the materialize_set_studio_compare_panes command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-patch-layer`

</td>
<td>

Enables the patch_layer command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-patch-layer`

</td>
<td>

Denies the patch_layer command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-peek-volume-metadata`

</td>
<td>

Enables the peek_volume_metadata command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-peek-volume-metadata`

</td>
<td>

Denies the peek_volume_metadata command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-preview-folder-ontology`

</td>
<td>

Enables the preview_folder_ontology command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-preview-folder-ontology`

</td>
<td>

Denies the preview_folder_ontology command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-preview-parcel-table`

</td>
<td>

Enables the preview_parcel_table command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-preview-parcel-table`

</td>
<td>

Denies the preview_parcel_table command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-preview-set-studio-imports`

</td>
<td>

Enables the preview_set_studio_imports command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-preview-set-studio-imports`

</td>
<td>

Denies the preview_set_studio_imports command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-preview-surface-parcel-table`

</td>
<td>

Enables the preview_surface_parcel_table command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-preview-surface-parcel-table`

</td>
<td>

Denies the preview_surface_parcel_table command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-project-volume-to-surface`

</td>
<td>

Enables the project_volume_to_surface command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-project-volume-to-surface`

</td>
<td>

Denies the project_volume_to_surface command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-promote-discovery-to-neurotabs`

</td>
<td>

Enables the promote_discovery_to_neurotabs command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-promote-discovery-to-neurotabs`

</td>
<td>

Denies the promote_discovery_to_neurotabs command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-query-slice-axis-meta`

</td>
<td>

Enables the query_slice_axis_meta command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-query-slice-axis-meta`

</td>
<td>

Denies the query_slice_axis_meta command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-recalculate-all-views`

</td>
<td>

Enables the recalculate_all_views command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-recalculate-all-views`

</td>
<td>

Denies the recalculate_all_views command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-recalculate-view-for-dimensions`

</td>
<td>

Enables the recalculate_view_for_dimensions command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-recalculate-view-for-dimensions`

</td>
<td>

Denies the recalculate_view_for_dimensions command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-register-categorical-colormap`

</td>
<td>

Enables the register_categorical_colormap command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-register-categorical-colormap`

</td>
<td>

Denies the register_categorical_colormap command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-release-layer-gpu-resources`

</td>
<td>

Enables the release_layer_gpu_resources command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-release-layer-gpu-resources`

</td>
<td>

Denies the release_layer_gpu_resources command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-release-sampler`

</td>
<td>

Enables the release_sampler command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-release-sampler`

</td>
<td>

Denies the release_sampler command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-remote-mount-connect`

</td>
<td>

Enables the remote_mount_connect command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-remote-mount-connect`

</td>
<td>

Denies the remote_mount_connect command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-remote-mount-respond-auth`

</td>
<td>

Enables the remote_mount_respond_auth command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-remote-mount-respond-auth`

</td>
<td>

Denies the remote_mount_respond_auth command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-remote-mount-respond-host-key`

</td>
<td>

Enables the remote_mount_respond_host_key command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-remote-mount-respond-host-key`

</td>
<td>

Denies the remote_mount_respond_host_key command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-remote-mount-unmount`

</td>
<td>

Enables the remote_mount_unmount command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-remote-mount-unmount`

</td>
<td>

Denies the remote_mount_unmount command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-remove-remote-mount-profile`

</td>
<td>

Enables the remove_remote_mount_profile command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-remove-remote-mount-profile`

</td>
<td>

Denies the remove_remote_mount_profile command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-render-view`

</td>
<td>

Enables the render_view command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-render-view`

</td>
<td>

Denies the render_view command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-render-views`

</td>
<td>

Enables the render_views command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-render-views`

</td>
<td>

Denies the render_views command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-request-frame`

</td>
<td>

Enables the request_frame command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-request-frame`

</td>
<td>

Denies the request_frame command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-request-layer-gpu-resources`

</td>
<td>

Enables the request_layer_gpu_resources command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-request-layer-gpu-resources`

</td>
<td>

Denies the request_layer_gpu_resources command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-resize-canvas`

</td>
<td>

Enables the resize_canvas command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-resize-canvas`

</td>
<td>

Denies the resize_canvas command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-sample-layer-value-at-world`

</td>
<td>

Enables the sample_layer_value_at_world command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-sample-layer-value-at-world`

</td>
<td>

Denies the sample_layer_value_at_world command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-sample-set-at-world`

</td>
<td>

Enables the sample_set_at_world command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-sample-set-at-world`

</td>
<td>

Denies the sample_set_at_world command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-sample-set-trace-at-world`

</td>
<td>

Enables the sample_set_trace_at_world command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-sample-set-trace-at-world`

</td>
<td>

Denies the sample_set_trace_at_world command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-sample-stack`

</td>
<td>

Enables the sample_stack command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-sample-stack`

</td>
<td>

Denies the sample_stack command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-sample-voxel-timeseries`

</td>
<td>

Enables the sample_voxel_timeseries command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-sample-voxel-timeseries`

</td>
<td>

Denies the sample_voxel_timeseries command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-sample-world-coordinate`

</td>
<td>

Enables the sample_world_coordinate command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-sample-world-coordinate`

</td>
<td>

Denies the sample_world_coordinate command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-scan-bids-dataset`

</td>
<td>

Enables the scan_bids_dataset command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-scan-bids-dataset`

</td>
<td>

Denies the scan_bids_dataset command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-select-parcel-column`

</td>
<td>

Enables the select_parcel_column command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-select-parcel-column`

</td>
<td>

Denies the select_parcel_column command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-set-crosshair`

</td>
<td>

Enables the set_crosshair command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-set-crosshair`

</td>
<td>

Denies the set_crosshair command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-set-layer-border`

</td>
<td>

Enables the set_layer_border command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-set-layer-border`

</td>
<td>

Denies the set_layer_border command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-set-layer-mask`

</td>
<td>

Enables the set_layer_mask command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-set-layer-mask`

</td>
<td>

Denies the set_layer_mask command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-set-volume-timepoint`

</td>
<td>

Enables the set_volume_timepoint command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-set-volume-timepoint`

</td>
<td>

Denies the set_volume_timepoint command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-start-analysis`

</td>
<td>

Enables the start_analysis command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-start-analysis`

</td>
<td>

Denies the start_analysis command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-start-atlas-progress-monitoring`

</td>
<td>

Enables the start_atlas_progress_monitoring command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-start-atlas-progress-monitoring`

</td>
<td>

Denies the start_atlas_progress_monitoring command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-start-set-studio-compare-materialization`

</td>
<td>

Enables the start_set_studio_compare_materialization command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-start-set-studio-compare-materialization`

</td>
<td>

Denies the start_set_studio_compare_materialization command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-submit-view`

</td>
<td>

Enables the submit_view command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-submit-view`

</td>
<td>

Denies the submit_view command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-toggle-atlas-favorite`

</td>
<td>

Enables the toggle_atlas_favorite command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-toggle-atlas-favorite`

</td>
<td>

Denies the toggle_atlas_favorite command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-unload-surface`

</td>
<td>

Enables the unload_surface command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-unload-surface`

</td>
<td>

Denies the unload_surface command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-unload-surface-overlay`

</td>
<td>

Enables the unload_surface_overlay command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-unload-surface-overlay`

</td>
<td>

Denies the unload_surface_overlay command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-unload-volume`

</td>
<td>

Enables the unload_volume command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-unload-volume`

</td>
<td>

Denies the unload_volume command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-update-frame-for-synchronized-view`

</td>
<td>

Enables the update_frame_for_synchronized_view command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-update-frame-for-synchronized-view`

</td>
<td>

Denies the update_frame_for_synchronized_view command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-update-frame-ubo`

</td>
<td>

Enables the update_frame_ubo command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-update-frame-ubo`

</td>
<td>

Denies the update_frame_ubo command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-update-layer-colormap`

</td>
<td>

Enables the update_layer_colormap command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-update-layer-colormap`

</td>
<td>

Denies the update_layer_colormap command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-update-layer-intensity`

</td>
<td>

Enables the update_layer_intensity command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-update-layer-intensity`

</td>
<td>

Denies the update_layer_intensity command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-update-layer-opacity`

</td>
<td>

Enables the update_layer_opacity command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-update-layer-opacity`

</td>
<td>

Denies the update_layer_opacity command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-update-layer-threshold`

</td>
<td>

Enables the update_layer_threshold command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-update-layer-threshold`

</td>
<td>

Denies the update_layer_threshold command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-update-slice-outline`

</td>
<td>

Enables the update_slice_outline command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-update-slice-outline`

</td>
<td>

Denies the update_slice_outline command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-validate-atlas-config`

</td>
<td>

Enables the validate_atlas_config command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-validate-atlas-config`

</td>
<td>

Denies the validate_atlas_config command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-validate-template-config`

</td>
<td>

Enables the validate_template_config command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-validate-template-config`

</td>
<td>

Denies the validate_template_config command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:allow-wait-for-layer-ready`

</td>
<td>

Enables the wait_for_layer_ready command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`api-bridge:deny-wait-for-layer-ready`

</td>
<td>

Denies the wait_for_layer_ready command without any pre-configured scope.

</td>
</tr>
</table>
