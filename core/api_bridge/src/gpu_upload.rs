//! Getting a layer's volume onto the GPU: the explicit request, the render
//! path's on-demand allocation, 4D resident-ring member swaps and the
//! readiness checks. Moved out of `lib.rs` (R1); policy lives in `residency`.

use crate::*;

pub(crate) async fn request_layer_gpu_resources_with_upload_hook(
    layer_spec: LayerSpec,
    metadata_only: Option<bool>,
    bridge_state: &BridgeState,
    after_upload: impl FnOnce() -> BridgeResult<()> + Send + 'static,
) -> BridgeResult<VolumeLayerGpuInfo> {
    let uploads = !metadata_only.unwrap_or(false);
    let LayerSpec::Volume(spec) = &layer_spec;
    let ids = (spec.id.clone(), spec.source_resource_id.clone());
    let backend_owner = uploads && bridge_state.residency.backend_owner();
    // A backend owner (R5c) resolves a budget refusal itself, so the request
    // may run again (its hook only with the first).
    let retry_spec = backend_owner.then(|| layer_spec.clone());
    let mut result =
        request_layer_gpu_resources_locked(layer_spec, metadata_only, bridge_state, after_upload)
            .await;
    if let Some(spec) = retry_spec {
        // Evict the policy's next victim and ask again, one at a time, until
        // the upload fits or nothing more may go. The skip marks stay until
        // the upload ends, so no frame takes the room first.
        while matches!(result, Err(BridgeError::GpuBudgetExceeded { .. })) {
            let room = admit(
                bridge_state,
                AdmitTarget::RoomFor {
                    layer_id: ids.0.clone(),
                    volume_id: ids.1.clone(),
                },
            )
            .await;
            if room.evicted == 0 {
                break;
            }
            result = request_layer_gpu_resources_locked(
                spec.clone(),
                metadata_only,
                bridge_state,
                || Ok(()),
            )
            .await;
        }
    }
    // Shadow comparison (R5b): a typed refusal opens an episode, the outcome
    // of the layer's later request closes it. A backend owner has no UI
    // evictions to compare.
    if uploads && !backend_owner {
        note_request(bridge_state, &ids.0, &ids.1, &result).await;
    }
    // The UI made room for this upload without letting frames retry starved
    // layers (`release_layer_gpu_resources_with(.., for_upload)`, reclaims):
    // now that the upload has its slot (or failed and left it free), they may.
    if uploads {
        clear_allocation_failed_skips(bridge_state, None).await;
    }
    result
}

pub(crate) async fn request_layer_gpu_resources_locked(
    layer_spec: LayerSpec,
    metadata_only: Option<bool>,
    bridge_state: &BridgeState,
    after_upload: impl FnOnce() -> BridgeResult<()> + Send + 'static,
) -> BridgeResult<VolumeLayerGpuInfo> {
    let _operation = bridge_state.volume_operations.lock().await;
    request_layer_gpu_resources_held(layer_spec, metadata_only, bridge_state, after_upload).await
}

/// [`request_layer_gpu_resources_locked`] for a caller that already holds
/// `volume_operations`: the residency executor (R5c), which evicts and
/// uploads in one pass under that lock.
pub(crate) async fn request_layer_gpu_resources_held(
    layer_spec: LayerSpec,
    metadata_only: Option<bool>,
    bridge_state: &BridgeState,
    after_upload: impl FnOnce() -> BridgeResult<()> + Send + 'static,
) -> BridgeResult<VolumeLayerGpuInfo> {
    let state = bridge_state;
    // Update return type
    info!(
        "Bridge: request_layer_gpu_resources called with spec: {:?}",
        layer_spec
    );
    info!("Bridge: request_layer_gpu_resources called");
    // error!("request_layer_gpu_resources is not implemented yet!"); // Remove error log

    match &layer_spec {
        LayerSpec::Volume(vol_spec) => {
            let source_volume_id = vol_spec.source_resource_id.clone();
            let ui_layer_id = vol_spec.id.clone();
            // Its residency changes: a frame may try the layer again (N18).
            state
                .render_skipped_layers
                .lock()
                .await
                .remove(&ui_layer_id);
            let metadata_only_flag = metadata_only.unwrap_or(false);
            if !metadata_only_flag && state.layer_slots.lock().await.contains(&ui_layer_id) {
                if layer_residency_is_live(state, &ui_layer_id, &source_volume_id).await {
                    return Err(BridgeError::Input {
                        code: 1006,
                        details: format!("Layer '{}' already owns GPU resources", ui_layer_id),
                    });
                }
                // The mapping outlived its residency: the slot was freed, or an
                // editable document's label slot lost its claim (N34). Release
                // it and upload afresh, so a retry recovers instead of adopting
                // the broken slot.
                warn!(
                    "Layer '{}' maps to a stale GPU residency; releasing it before re-uploading",
                    ui_layer_id
                );
                release_layer_gpu_resources_held(ui_layer_id.clone(), state).await?;
            }

            info!(
                "Requesting {} for UI layer '{}' (source volume '{}')",
                if metadata_only_flag {
                    "metadata only"
                } else {
                    "GPU resources"
                },
                ui_layer_id,
                source_volume_id
            );

            // --- 1. Get the RenderLoopService handle (only if not metadata_only) ---
            // Clone the inner Arc<Mutex<RenderLoopService>> and release the outer lock
            // immediately. The heavy upload below runs on a blocking thread and locks
            // this itself, so we must NOT hold a guard across it (that would deadlock
            // the blocking task's blocking_lock).
            let service_arc = if !metadata_only_flag {
                let guard = state.render_loop_service.lock().await;
                let arc = guard
                    .as_ref()
                    .ok_or_else(|| {
                        error!("RenderLoopService is not available.");
                        BridgeError::ServiceNotInitialized {
                            code: 5002,
                            details: "GPU rendering service is not initialized. Please ensure the application has started correctly.".to_string()
                        }
                    })?
                    .clone();
                Some(arc)
            } else {
                None
            };

            // --- 2. Get VolumeSendable with Enhanced Registry Verification ---
            let volume_registry_guard = state.volume_registry.lock().await;

            // Enhanced verification for template loading timing issues
            if !volume_registry_guard
                .volumes
                .contains_key(&source_volume_id)
            {
                warn!(
                    "Volume {} not found in registry during GPU allocation - possible timing issue",
                    source_volume_id
                );

                // Log registry state for debugging
                info!(
                    "Registry contains {} volumes: {:?}",
                    volume_registry_guard.volumes.len(),
                    volume_registry_guard.volumes.keys().collect::<Vec<_>>()
                );

                drop(volume_registry_guard);
                return Err(BridgeError::VolumeNotFound {
                    code: 4044,
                    details: format!(
                        "Volume {} not ready in registry. This may indicate a timing issue between template loading and GPU allocation.",
                        source_volume_id
                    ),
                });
            }

            let volume_arc = volume_registry_guard
                .get_render_arc(&source_volume_id)
                .ok_or_else(|| {
                    error!("Volume not found in registry: {}", source_volume_id);
                    BridgeError::VolumeNotFound {
                        code: 4042,
                        details: format!(
                            "Volume '{}' not found. Please load the volume first using load_file.",
                            source_volume_id
                        ),
                    }
                })?;

            // Atlas/parcellation volumes are discrete label maps; they must keep exact
            // integer ids on the GPU (no R8Unorm normalization). load_atlas tags them
            // with an "atlas:" metadata path.
            let is_label_atlas = volume_registry_guard
                .get_entry(&source_volume_id)
                .map(|e| e.metadata.path.starts_with("atlas:"))
                .unwrap_or(false);

            let editable_revision = volume_registry_guard
                .get_entry(&source_volume_id)
                .and_then(|entry| entry.editable_revision);

            // Capture the current 4D timepoint before releasing the registry lock so
            // neither the off-reactor upload nor the post-upload bookkeeping needs the
            // registry. `timepoint` is the unwrapped index used during upload;
            // `timepoint_opt` preserves the None-vs-Some distinction the layer map wants.
            let timepoint_opt = volume_registry_guard.get_timepoint(&source_volume_id);
            let timepoint = timepoint_opt.unwrap_or(0);

            // Release the registry lock now. Everything downstream reads the volume
            // through this Arc clone, so the lock is no longer needed -- and it must
            // not be held across the heavy upload.
            drop(volume_registry_guard);
            let volume_data: &VolumeSendable = volume_arc.as_ref();

            // --- 3. Extract slice parameters from layer spec ---
            let slice_axis = vol_spec.slice_axis.unwrap_or_default();
            let slice_index_spec = vol_spec.slice_index.clone().unwrap_or_default();

            // Get volume dimensions to calculate actual slice index
            let vol_dims_temp = get_spatial_dims_from_volume(volume_data);

            // Calculate the actual slice index based on the specification
            let _slice_idx =
                calculate_slice_index(&slice_index_spec, &vol_dims_temp, slice_axis, volume_data)?;

            // Upload the entire volume as a 3D texture and get the world-to-voxel transform
            // Skip if metadata_only is true
            let (atlas_slot, _volume_world_to_voxel, mut provisional_upload) = if metadata_only_flag
            {
                info!("Metadata-only mode: skipping GPU upload");
                (None, nalgebra::Matrix4::<f32>::identity(), None) // No allocation
            } else {
                debug!("About to upload volume to GPU (off the async reactor)");
                // Run the heavy convert + GPU write on a blocking thread so the async
                // reactor stays responsive, holding ONLY the render-service lock (the
                // registry lock was already dropped). The volume is an Arc clone.
                let upload_service = service_arc
                    .clone()
                    .expect("service arc present when not in metadata_only mode");
                let upload_owner = volume_loading::UploadOwner::new(
                    state,
                    Arc::clone(&upload_service),
                    ui_layer_id.clone(),
                );
                let upload_volume = volume_arc.clone();
                let upload_resident_sets = Arc::clone(&state.resident_image_sets);
                let upload_ui_layer_id = ui_layer_id.clone();
                tokio::task::spawn_blocking(
                    move || -> BridgeResult<(Option<SlotHandle>, nalgebra::Matrix4<f32>, Option<volume_loading::ProvisionalUpload>)> {
                        let mut render_service_guard = upload_service.blocking_lock();
                        let render_service = &mut *render_service_guard;
                        if render_service.residency_metrics().resident_limit.is_some()
                            && render_service.free_volume_slot_count() == 0 {
                            let mut sets = upload_resident_sets.blocking_lock();
                            reclaim_cached_image_slot(&mut sets, render_service);
                        }
                        let volume_data: &VolumeSendable = upload_volume.as_ref();
                        let ui_layer_id = upload_ui_layer_id;
                        // A 4D layer shows its current frame; integer-label
                        // preservation applies to whole 3D label volumes only.
                        let extracted;
                        let (upload_source, preserve_labels) =
                            if volume_sendable_uses_timepoint(volume_data) {
                                info!("Extracting timepoint {} from 4D volume", timepoint);
                                extracted = extract_3d_volume_at_timepoint(volume_data, timepoint)?;
                                (&extracted, false)
                            } else {
                                (volume_data, is_label_atlas)
                            };
                        let mut result = upload_layer_volume(
                            render_service, &ui_layer_id, upload_source, preserve_labels, editable_revision,
                        );
                        while result.as_ref().is_err_and(retryable_budget_pressure) {
                            let reclaimed = {
                                let mut sets = upload_resident_sets.blocking_lock();
                                reclaim_cached_image_members(&mut sets, render_service, 1)
                            };
                            if reclaimed == 0 { break; }
                            result = upload_layer_volume(
                                render_service, &ui_layer_id, upload_source, preserve_labels, editable_revision,
                            );
                        }
                        let upload_result = result?;
                        let guard = volume_loading::ProvisionalUpload::new(upload_result.0, upload_owner);
                        after_upload()?;
                        Ok((Some(upload_result.0), upload_result.1, Some(guard)))
                    },
                )
                .await
                .map_err(|e| BridgeError::Internal {
                    code: 5099,
                    details: format!("GPU upload task panicked: {e}"),
                })??
            };
            let atlas_layer_idx = atlas_slot.map_or(u32::MAX, SlotHandle::index);

            // Re-acquire the render-service lock for the light post-upload bookkeeping
            // below (data range, declarative registration, layer add). It was released
            // when the blocking upload task finished.
            let mut render_loop_service = match service_arc.as_ref() {
                Some(arc) => Some(arc.lock().await),
                None => None,
            };

            // For 3D textures, texture coordinates are always the full texture
            let (u_min, v_min, u_max, v_max) = (0.0, 0.0, 1.0, 1.0);

            // Get volume dimensions and format for the response
            let spatial_dims = get_spatial_dims_from_volume(volume_data);
            let vol_dims = [
                spatial_dims[0] as u32,
                spatial_dims[1] as u32,
                spatial_dims[2] as u32,
            ];

            let gpu_format = if metadata_only_flag {
                // No allocation exists yet; retain a source-type hint for this
                // provisional response. Uploaded layers report actual storage.
                match volume_data {
                    VolumeSendable::VolF32(_, _) | VolumeSendable::Vec4DF32(_) => {
                        GpuTextureFormat::R32Float
                    }
                    VolumeSendable::VolI16(_, _) | VolumeSendable::Vec4DI16(_) => {
                        GpuTextureFormat::R16Float
                    }
                    VolumeSendable::VolU8(_, _) | VolumeSendable::Vec4DU8(_) => {
                        GpuTextureFormat::R8Unorm
                    }
                    VolumeSendable::VolI8(_, _) | VolumeSendable::Vec4DI8(_) => {
                        GpuTextureFormat::R8Unorm
                    }
                    VolumeSendable::VolU16(_, _) | VolumeSendable::Vec4DU16(_) => {
                        GpuTextureFormat::R16Float
                    }
                    VolumeSendable::VolI32(_, _) | VolumeSendable::Vec4DI32(_) => {
                        GpuTextureFormat::R32Float
                    }
                    VolumeSendable::VolU32(_, _) | VolumeSendable::Vec4DU32(_) => {
                        GpuTextureFormat::R32Float
                    }
                    VolumeSendable::VolF64(_, _) | VolumeSendable::Vec4DF64(_) => {
                        GpuTextureFormat::R32Float
                    }
                }
            } else {
                let renderer = render_loop_service.as_ref().ok_or_else(|| {
                    gpu_allocation_error(&ui_layer_id, "Render service unavailable after upload")
                })?;
                uploaded_gpu_format(renderer, atlas_layer_idx)?
            };

            // Get the affine transform (voxel to world) and extract space info - clone before dropping the guard
            let affine = get_affine_from_volume(volume_data)?;

            let (origin, spacing) = match volume_data {
                // 3D volumes
                VolumeSendable::VolF32(vol, _) => {
                    let space = vol.space();
                    (space.origin().to_vec(), space.spacing().to_vec())
                }
                VolumeSendable::VolI16(vol, _) => {
                    let space = vol.space();
                    (space.origin().to_vec(), space.spacing().to_vec())
                }
                VolumeSendable::VolU8(vol, _) => {
                    let space = vol.space();
                    (space.origin().to_vec(), space.spacing().to_vec())
                }
                VolumeSendable::VolI8(vol, _) => {
                    let space = vol.space();
                    (space.origin().to_vec(), space.spacing().to_vec())
                }
                VolumeSendable::VolU16(vol, _) => {
                    let space = vol.space();
                    (space.origin().to_vec(), space.spacing().to_vec())
                }
                VolumeSendable::VolI32(vol, _) => {
                    let space = vol.space();
                    (space.origin().to_vec(), space.spacing().to_vec())
                }
                VolumeSendable::VolU32(vol, _) => {
                    let space = vol.space();
                    (space.origin().to_vec(), space.spacing().to_vec())
                }
                VolumeSendable::VolF64(vol, _) => {
                    let space = vol.space();
                    (space.origin().to_vec(), space.spacing().to_vec())
                }
                // 4D volumes
                VolumeSendable::Vec4DF32(vec) => {
                    let space = &vec.space;
                    // Extract origin and spacing from first 3 dimensions, converting to f32
                    let origin = vec![
                        space.origin[0] as f32,
                        space.origin[1] as f32,
                        space.origin[2] as f32,
                    ];
                    let spacing = vec![
                        space.spacing[0] as f32,
                        space.spacing[1] as f32,
                        space.spacing[2] as f32,
                    ];
                    (origin, spacing)
                }
                VolumeSendable::Vec4DI16(vec) => {
                    let space = &vec.space;
                    let origin = vec![
                        space.origin[0] as f32,
                        space.origin[1] as f32,
                        space.origin[2] as f32,
                    ];
                    let spacing = vec![
                        space.spacing[0] as f32,
                        space.spacing[1] as f32,
                        space.spacing[2] as f32,
                    ];
                    (origin, spacing)
                }
                VolumeSendable::Vec4DU8(vec) => {
                    let space = &vec.space;
                    let origin = vec![
                        space.origin[0] as f32,
                        space.origin[1] as f32,
                        space.origin[2] as f32,
                    ];
                    let spacing = vec![
                        space.spacing[0] as f32,
                        space.spacing[1] as f32,
                        space.spacing[2] as f32,
                    ];
                    (origin, spacing)
                }
                VolumeSendable::Vec4DI8(vec) => {
                    let space = &vec.space;
                    let origin = vec![
                        space.origin[0] as f32,
                        space.origin[1] as f32,
                        space.origin[2] as f32,
                    ];
                    let spacing = vec![
                        space.spacing[0] as f32,
                        space.spacing[1] as f32,
                        space.spacing[2] as f32,
                    ];
                    (origin, spacing)
                }
                VolumeSendable::Vec4DU16(vec) => {
                    let space = &vec.space;
                    let origin = vec![
                        space.origin[0] as f32,
                        space.origin[1] as f32,
                        space.origin[2] as f32,
                    ];
                    let spacing = vec![
                        space.spacing[0] as f32,
                        space.spacing[1] as f32,
                        space.spacing[2] as f32,
                    ];
                    (origin, spacing)
                }
                VolumeSendable::Vec4DI32(vec) => {
                    let space = &vec.space;
                    let origin = vec![
                        space.origin[0] as f32,
                        space.origin[1] as f32,
                        space.origin[2] as f32,
                    ];
                    let spacing = vec![
                        space.spacing[0] as f32,
                        space.spacing[1] as f32,
                        space.spacing[2] as f32,
                    ];
                    (origin, spacing)
                }
                VolumeSendable::Vec4DU32(vec) => {
                    let space = &vec.space;
                    let origin = vec![
                        space.origin[0] as f32,
                        space.origin[1] as f32,
                        space.origin[2] as f32,
                    ];
                    let spacing = vec![
                        space.spacing[0] as f32,
                        space.spacing[1] as f32,
                        space.spacing[2] as f32,
                    ];
                    (origin, spacing)
                }
                VolumeSendable::Vec4DF64(vec) => {
                    let space = &vec.space;
                    let origin = vec![
                        space.origin[0] as f32,
                        space.origin[1] as f32,
                        space.origin[2] as f32,
                    ];
                    let spacing = vec![
                        space.spacing[0] as f32,
                        space.spacing[1] as f32,
                        space.spacing[2] as f32,
                    ];
                    (origin, spacing)
                }
            };

            // Get world_to_voxel matrix (inverse of voxel_to_world affine)
            let voxel_to_world = affine.to_homogeneous();
            let world_to_voxel = voxel_to_world
                .try_inverse()
                .unwrap_or_else(Matrix4::identity);

            // CRITICAL FIX: Convert to column-major order for WGSL
            // WGSL expects mat4x4<f32> in column-major order
            // nalgebra uses column-major internally, but we need to flatten correctly
            let world_to_voxel_flat: [f32; 16] = [
                world_to_voxel[(0, 0)],
                world_to_voxel[(1, 0)],
                world_to_voxel[(2, 0)],
                world_to_voxel[(3, 0)], // Column 0
                world_to_voxel[(0, 1)],
                world_to_voxel[(1, 1)],
                world_to_voxel[(2, 1)],
                world_to_voxel[(3, 1)], // Column 1
                world_to_voxel[(0, 2)],
                world_to_voxel[(1, 2)],
                world_to_voxel[(2, 2)],
                world_to_voxel[(3, 2)], // Column 2
                world_to_voxel[(0, 3)],
                world_to_voxel[(1, 3)],
                world_to_voxel[(2, 3)],
                world_to_voxel[(3, 3)], // Column 3
            ];

            // Convert voxel_to_world matrix to flat array (column-major for WGSL)
            let voxel_to_world_flat: [f32; 16] = [
                voxel_to_world[(0, 0)],
                voxel_to_world[(1, 0)],
                voxel_to_world[(2, 0)],
                voxel_to_world[(3, 0)], // Column 0
                voxel_to_world[(0, 1)],
                voxel_to_world[(1, 1)],
                voxel_to_world[(2, 1)],
                voxel_to_world[(3, 1)], // Column 1
                voxel_to_world[(0, 2)],
                voxel_to_world[(1, 2)],
                voxel_to_world[(2, 2)],
                voxel_to_world[(3, 2)], // Column 2
                voxel_to_world[(0, 3)],
                voxel_to_world[(1, 3)],
                voxel_to_world[(2, 3)],
                voxel_to_world[(3, 3)], // Column 3
            ];

            // Calculate center world coordinates
            let center_voxel = nalgebra::Vector4::new(
                (vol_dims[0] as f32 - 1.0) * 0.5,
                (vol_dims[1] as f32 - 1.0) * 0.5,
                (vol_dims[2] as f32 - 1.0) * 0.5,
                1.0,
            );
            let center_world = voxel_to_world * center_voxel;
            let center_world_coords = [center_world.x, center_world.y, center_world.z];

            debug!(
                "Volume center calculation: voxel [{:.1}, {:.1}, {:.1}] -> world [{:.1}, {:.1}, {:.1}]",
                center_voxel.x,
                center_voxel.y,
                center_voxel.z,
                center_world_coords[0],
                center_world_coords[1],
                center_world_coords[2]
            );

            // Debug the transform matrices - log in column-major format for nalgebra
            debug!("Voxel Dims: {:?}", vol_dims);
            debug!(
                "Center Voxel Input: [{:.1}, {:.1}, {:.1}, {:.1}]",
                center_voxel.x, center_voxel.y, center_voxel.z, center_voxel.w
            );
            debug!("Voxel-to-world transform matrix (column-major):");
            for i in 0..4 {
                debug!(
                    "  [{:.3}, {:.3}, {:.3}, {:.3}]",
                    voxel_to_world[(i, 0)],
                    voxel_to_world[(i, 1)],
                    voxel_to_world[(i, 2)],
                    voxel_to_world[(i, 3)]
                );
            }
            debug!("World-to-voxel transform matrix (column-major):");
            for i in 0..4 {
                debug!(
                    "  [{:.3}, {:.3}, {:.3}, {:.3}]",
                    world_to_voxel[(i, 0)],
                    world_to_voxel[(i, 1)],
                    world_to_voxel[(i, 2)],
                    world_to_voxel[(i, 3)]
                );
            }

            // Also log the affine directly
            debug!("Original affine from NIfTI:");
            let affine_matrix = affine.to_homogeneous();
            for i in 0..4 {
                debug!(
                    "  [{:.3}, {:.3}, {:.3}, {:.3}]",
                    affine_matrix[(i, 0)],
                    affine_matrix[(i, 1)],
                    affine_matrix[(i, 2)],
                    affine_matrix[(i, 3)]
                );
            }

            // Determine slice dimensions based on axis
            let _slice_dims = match slice_axis {
                SliceAxis::Sagittal => [vol_dims[1], vol_dims[2]], // YZ plane
                SliceAxis::Coronal => [vol_dims[0], vol_dims[2]],  // XZ plane
                SliceAxis::Axial => [vol_dims[0], vol_dims[1]],    // XY plane
            };

            // Create slice info - use axis 255 to indicate full 3D volume
            let slice_info = SliceInfo {
                axis: 255, // Special value indicating 3D volume, not a slice
                index: 0,  // Not used for 3D volumes
                axis_name: "3D Volume".to_string(),
                dimensions: [vol_dims[0], vol_dims[1]], // Just use first two dims for compatibility
            };

            // Create texture coordinates
            let texture_coords = TextureCoordinates {
                u_min,
                v_min,
                u_max,
                v_max,
            };

            // Get current timestamp
            let allocated_at = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();

            debug!(
                "Successfully uploaded volume to GPU - layer_id: {}, atlas_layer: {}, dims: {:?}, format: {:?}",
                ui_layer_id, atlas_layer_idx, vol_dims, gpu_format
            );
            debug!(
                "Texture coordinates - u: [{:.4}, {:.4}], v: [{:.4}, {:.4}]",
                u_min, u_max, v_min, v_max
            );

            // --- Compute data range and binary-like flag ---
            let (min_val, max_val) = if metadata_only_flag {
                compute_data_range_from_volume(volume_data)
            } else {
                let render_service = render_loop_service
                    .as_ref()
                    .expect("RenderLoopService should be available when not in metadata_only mode");
                render_service
                    .get_volume_data_range(atlas_layer_idx)
                    .unwrap_or_else(|| {
                        warn!(
                            "No cached data_range for atlas index {}; falling back to CPU scan",
                            atlas_layer_idx
                        );
                        compute_data_range_from_volume(volume_data)
                    })
            };
            // Display uses the 0-1 window for any data within [0, 1]; the
            // reported mask flag requires a true {0, 1} image.
            let in_unit_range = min_val >= 0.0 && max_val <= 1.0;
            let is_binary_like = in_unit_range && volume_queries::is_binary_volume(volume_data);
            let data_range = Some(DataRange {
                min: min_val,
                max: max_val,
            });

            // Get colormap ID first
            let colormap_id = match colormap_by_name(&vol_spec.colormap) {
                Some(id) => id.id() as u32,
                None => {
                    error!(
                        "Unknown colormap '{}', defaulting to grayscale",
                        vol_spec.colormap
                    );
                    0 // Default to grayscale
                }
            };

            // Register the volume for the declarative API using the source volume ID.
            // The ViewState renderer resolves the texture through this registry
            // binding and rebuilds the per-frame render-layer list from the
            // visible layers, so an upload makes the texture resident without
            // adding an imperative render-layer entry: uploads must not count
            // against the per-frame draw cap (`MAX_RENDER_LAYERS`).
            if metadata_only_flag {
                info!("Metadata-only mode: skipping volume registration");
            } else {
                let render_service = render_loop_service
                    .as_mut()
                    .expect("RenderLoopService should be available when not in metadata_only mode");

                if let Err(e) = render_service.register_volume_with_range(
                    source_volume_id.clone(),
                    atlas_layer_idx,
                    (min_val, max_val),
                ) {
                    warn!(
                        "Failed to register volume {} with atlas index {}: {:?}",
                        source_volume_id, atlas_layer_idx, e
                    );
                    // Continue anyway - the volume is uploaded and can be used imperatively
                } else {
                    info!(
                        "Successfully registered volume '{}' with atlas index {} for declarative API with data range ({}, {})",
                        source_volume_id, atlas_layer_idx, min_val, max_val
                    );
                }
                info!(
                    "Uploaded layer texture {} with colormap {} (id {}) and data range ({}, {})",
                    atlas_layer_idx, vol_spec.colormap, colormap_id, min_val, max_val
                );
            }
            if is_binary_like {
                info!("Detected binary mask - using 0-1 display range");
            }

            // Store the mapping between UI layer ID and atlas index (only if GPU was allocated)
            if !metadata_only_flag {
                if let Some(renderer) = render_loop_service.as_deref_mut() {
                    release_superseded_lease(state, &ui_layer_id, renderer).await;
                }
                {
                    let mut layer_map = state.layer_slots.lock().await;
                    debug!(
                        "📌 STORING layer mapping: UI layer '{}' -> atlas index {}",
                        ui_layer_id, atlas_layer_idx
                    );
                    layer_map.insert(
                        ui_layer_id.clone(),
                        atlas_slot.expect("an upload has a slot"),
                    );
                    debug!(
                        "📌 Layer map now contains {} entries: {:?}",
                        layer_map.len(),
                        layer_map.iter().map(|(id, _)| id).collect::<Vec<_>>()
                    );
                }

                {
                    // Also store the volume handle mapping
                    let mut volume_map = state.layer_to_volume_map.lock().await;
                    let LayerSpec::Volume(vol_spec) = &layer_spec;
                    volume_map.insert(ui_layer_id.clone(), vol_spec.source_resource_id.clone());
                }

                {
                    let uploaded_timepoint = if volume_sendable_uses_timepoint(volume_data) {
                        timepoint_opt
                    } else {
                        None
                    };
                    let mut timepoint_map = state.layer_to_timepoint_map.lock().await;
                    timepoint_map.insert(ui_layer_id.clone(), uploaded_timepoint);
                }

                let lease = LayerLease::new(
                    ui_layer_id.clone(),
                    atlas_slot.expect("an upload has a slot"),
                    Arc::clone(&state.render_loop_service),
                    Arc::clone(&state.layer_slots),
                    Arc::clone(&state.layer_to_volume_map),
                    Arc::clone(&state.layer_to_timepoint_map),
                    Arc::clone(&state.resident_image_sets),
                );

                if let Some(upload) = provisional_upload.as_mut() {
                    upload.transfer_to_lease();
                }

                {
                    let mut lease_map = state.layer_leases.lock().await;
                    lease_map.insert(ui_layer_id.clone(), Arc::new(lease));
                }
            }

            Ok(VolumeLayerGpuInfo {
                layer_id: ui_layer_id,
                world_to_voxel: world_to_voxel_flat,
                dim: vol_dims,
                pad_slices: 1,
                tex_format: gpu_format,
                atlas_layer_index: atlas_layer_idx,
                slice_info,
                texture_coords,
                voxel_to_world: voxel_to_world_flat,
                origin: [origin[0], origin[1], origin[2]],
                center_world: center_world_coords,
                spacing: [spacing[0], spacing[1], spacing[2]],
                data_range,
                source_volume_id,
                allocated_at,
                is_binary_like,
            })
        } // Other layer types would go here
    }
}

pub(crate) async fn is_layer_ready_internal(layer_id: &str, state: &BridgeState) -> bool {
    if !state.layer_slots.lock().await.contains(layer_id) {
        return false;
    }

    let has_volume_mapping = {
        let volume_map = state.layer_to_volume_map.lock().await;
        volume_map.contains_key(layer_id)
    };
    if !has_volume_mapping {
        return false;
    }

    let service_arc_opt = { state.render_loop_service.lock().await.clone() };
    let Some(service_arc) = service_arc_opt else {
        return false;
    };

    // Ready means its own texture is resident: the mapped residency is
    // current, not merely its index filled (perhaps by another upload).
    // Uploads add no per-frame render entry (only a frame that draws the layer
    // does), so the render state cannot answer this.
    let service = service_arc.lock().await;
    let slots = state.layer_slots.lock().await;
    slots.current(layer_id, &service).is_some()
}

/// Try to satisfy a member change through the GPU-resident ring instead of the
/// legacy invalidate + extract + re-upload path.
///
/// Returns `Ok(Some(slot))` with the residency the layer now samples — a pure
/// `texture_index` swap on a resident hit, or one in-place upload on a miss.
/// `current` is the layer's current residency (checked by the caller). Returns
/// `Ok(None)` to fall back to the legacy path (feature disabled, not a multi-member
/// volume, member out of range, missing volume, or the layer could not be
/// repointed). The ring is created lazily on the first member change, seeded at the
/// slot the layer currently occupies.
pub(crate) async fn try_resident_swap(
    layer_id: &str,
    volume_id: &str,
    current: SlotHandle,
    cached_member: Option<usize>,
    requested_member: usize,
    bridge_state: &BridgeState,
    service: &mut RenderLoopService,
) -> BridgeResult<Option<SlotHandle>> {
    // A binding position, taken from the caller's current handle.
    let current_slot = current.index();
    if !resident_image_set_enabled() {
        return Ok(None);
    }

    let mut sets = bridge_state.resident_image_sets.lock().await;

    if !sets.contains_key(layer_id) {
        let (volume_arc, tr_seconds, preserve_labels) = {
            let registry = bridge_state.volume_registry.lock().await;
            match registry.get_entry(volume_id) {
                Some(entry) => (
                    entry.data.clone(),
                    entry
                        .metadata
                        .time_series_info
                        .as_ref()
                        .and_then(|ts| ts.tr),
                    entry.metadata.path.starts_with("atlas:"),
                ),
                None => return Ok(None),
            }
        };

        let set = match image_set::Raw4DImageSet::new(volume_arc, tr_seconds) {
            Some(set) => set,
            None => return Ok(None), // plain 3-D volume: no member axis
        };

        let seed_member = cached_member.unwrap_or(0);
        // The ring takes over the residency the layer shows now.
        if !service.is_slot_current(current) {
            return Ok(None);
        }
        let seed_slot = current;
        let resident = image_set::ResidentImageSet::new(
            Box::new(set),
            seed_member,
            seed_slot,
            RESIDENT_RING_MAX_SLOTS,
            RESIDENT_RING_BUDGET_BYTES,
            preserve_labels,
        );
        sets.insert(layer_id.to_string(), resident);
    }

    // Phase 1: make the requested member resident (may upload once on a miss).
    let outcome = {
        let resident = sets.get_mut(layer_id).expect("resident set inserted above");
        if requested_member >= resident.member_count() {
            return Ok(None);
        }
        resident.ensure_member(requested_member, service)?
    };
    // The residency the layer will show; the ring recorded it with the upload
    // or still holds it from before.
    let Some(shown) = sets
        .get(layer_id)
        .and_then(|resident| resident.handle_of(outcome.texture_index))
    else {
        warn!(
            "Resident image-set for layer '{}' holds no residency at slot {}; falling back to re-upload",
            layer_id, outcome.texture_index
        );
        if let Some(mut resident) = sets.remove(layer_id) {
            resident.release_all(service);
        }
        return Ok(None);
    };

    // Phase 2: if the imperative render-layer path owns an entry for this slot,
    // repoint that layer before publishing the new ViewState registry binding.
    // Some ViewState-only call paths have no imperative layer entry; those still
    // render from `RenderLoopService::volumes[volume_id].atlas_index` below.
    if service.has_render_layer_for_atlas(current_slot) {
        if let Err(e) = service.set_layer_texture_index(current_slot, outcome.texture_index) {
            warn!(
                "Resident image-set could not repoint layer '{}' from slot {} to {}; falling back to re-upload: {:?}",
                layer_id, current_slot, outcome.texture_index, e
            );
            if let Some(mut resident) = sets.remove(layer_id) {
                resident.release_all(service);
            }
            return Ok(None);
        }
    }

    // Phase 3: repoint the `volume_id -> slot` binding the ViewState render
    // resolves (`RenderLoopService::volumes[volume_id].atlas_index`) at the resident
    // member. This is the actual swap the ViewState renderer reads each frame — a
    // metadata update with no `write_texture`. On failure, tear the ring down and
    // fall back so the legacy path can rebuild cleanly.
    let data_range = service
        .get_volume_data_range(outcome.texture_index)
        .unwrap_or((0.0, 1.0));
    if let Err(e) =
        service.register_volume_with_range(volume_id.to_string(), outcome.texture_index, data_range)
    {
        warn!(
            "Resident image-set could not repoint volume '{}' to slot {}; falling back to re-upload: {:?}",
            volume_id, outcome.texture_index, e
        );
        if let Some(mut resident) = sets.remove(layer_id) {
            resident.release_all(service);
        }
        return Ok(None);
    }

    // Phase 4: record the current member and prefetch neighbours into free capacity.
    {
        let resident = sets.get_mut(layer_id).expect("resident set present");
        resident.current_member = requested_member;
        if let Err(e) =
            resident.prefetch_around(requested_member, RESIDENT_RING_PREFETCH_RADIUS, service)
        {
            debug!("Resident image-set prefetch around {requested_member} failed: {e:?}");
        }
    }

    // Keep the bridge's per-layer maps and the lease consistent with the swap:
    // the lease now owns the residency the layer shows.
    if let Some(lease) = bridge_state.layer_leases.lock().await.get(layer_id) {
        lease.repoint(shown);
    }
    {
        let mut layer_map = bridge_state.layer_slots.lock().await;
        layer_map.insert(layer_id, shown);
    }
    {
        let mut timepoint_map = bridge_state.layer_to_timepoint_map.lock().await;
        timepoint_map.insert(layer_id.to_string(), Some(requested_member));
    }

    Ok(Some(shown))
}

/// Release `layer_id`'s stale residency and upload `volume_id` for it again
/// through [`upload_layer_volume`], so an editable document's labels come back
/// claimed at the registry's current revision. The caller holds
/// `volume_operations`.
pub(crate) async fn reupload_layer_locked(
    state: &BridgeState,
    layer_id: &str,
    volume_id: &str,
) -> BridgeResult<()> {
    release_layer_gpu_resources_held(layer_id.to_string(), state).await?;
    let timepoint = state.volume_registry.lock().await.get_timepoint(volume_id);
    let service = state
        .render_loop_service
        .lock()
        .await
        .clone()
        .ok_or_else(|| BridgeError::ServiceNotInitialized {
            code: 5002,
            details: "GPU rendering service is not initialized.".to_string(),
        })?;
    let mut service = service.lock().await;
    allocate_gpu_resources_for_layer(layer_id, volume_id, state, &mut service, timepoint).await?;
    drop(service);
    // Its residency changed: a frame may draw it again.
    state.render_skipped_layers.lock().await.remove(layer_id);
    Ok(())
}

/// Whether `layer_id`'s mapping names a residency that still serves it: its
/// slot holds data, the layer's lease owns that slot (every allocation is
/// leased, so a mapping without one is stale), and an editable document's
/// labels are claimed for `volume_id` in that very slot (another layer may
/// show the same document from its own slot).
///
/// The service lock comes first, as the lock order requires, so a concurrent
/// resident swap cannot move the map and the lease between the reads.
pub(crate) async fn layer_residency_is_live(
    state: &BridgeState,
    layer_id: &str,
    volume_id: &str,
) -> bool {
    let Some(service) = state.render_loop_service.lock().await.clone() else {
        return state.layer_slots.lock().await.contains(layer_id);
    };
    let service = service.lock().await;
    let editable = state
        .volume_registry
        .lock()
        .await
        .get_entry(volume_id)
        .is_some_and(|entry| entry.editable_revision.is_some());
    let Some(mapped) = state.layer_slots.lock().await.current(layer_id, &service) else {
        return false;
    };
    let Some(lease_slot) = state
        .layer_leases
        .lock()
        .await
        .get(layer_id)
        .map(|lease| lease.slot())
    else {
        return false;
    };
    let leased = lease_slot == mapped;
    let claimed = !editable || editable_handle_at(&service, volume_id, mapped).is_some();
    leased && claimed
}

/// The editable claim of `slot` for `volume_id`, while `slot` is still that
/// residency: a claim on its index from a later upload is not this one.
pub(crate) fn editable_handle_at(
    service: &RenderLoopService,
    volume_id: &str,
    slot: SlotHandle,
) -> Option<render_loop::EditableTextureHandle> {
    service
        .multi_texture_manager
        .as_ref()?
        .editable_handle_for_volume(volume_id, slot.index())
        .filter(|handle| handle.slot() == slot)
}

/// The one way a layer's 3-D volume reaches the GPU: the explicit request, the
/// render path's on-demand allocation and resident image-set members all come
/// here. Labels of an open editable document (`editable_revision`) go through
/// `upload_editable_labels`, claimed at the registry's current revision, so the
/// residency is always editable and `editable_labels::synchronize_locked` finds
/// its handle once the volume is registered at the slot (N34). Returns the
/// residency it filled, taken under the same service lock as the upload.
pub(crate) fn upload_layer_volume(
    service: &mut RenderLoopService,
    layer_id: &str,
    volume: &VolumeSendable,
    preserve_labels: bool,
    editable_revision: Option<u64>,
) -> BridgeResult<(SlotHandle, nalgebra::Matrix4<f32>)> {
    let failed = |e: render_loop::RenderLoopError| renderer_gpu_error(layer_id, e);
    let (index, world_to_voxel) = match volume {
        VolumeSendable::VolU16(vol, _) if editable_revision.is_some() => {
            let handle = service
                .upload_editable_labels(vol, editable_revision.expect("checked above"))
                .map_err(failed)?;
            return Ok((handle.slot(), vol.space().world_to_voxel()));
        }
        VolumeSendable::VolF32(vol, _) => service.upload_volume_3d_labelaware(vol, preserve_labels),
        VolumeSendable::VolI16(vol, _) => service.upload_volume_3d_labelaware(vol, preserve_labels),
        VolumeSendable::VolU8(vol, _) => service.upload_volume_3d_labelaware(vol, preserve_labels),
        VolumeSendable::VolI8(vol, _) => service.upload_volume_3d_labelaware(vol, preserve_labels),
        VolumeSendable::VolU16(vol, _) => service.upload_volume_3d_labelaware(vol, preserve_labels),
        VolumeSendable::VolI32(vol, _) => service.upload_volume_3d_labelaware(vol, preserve_labels),
        VolumeSendable::VolU32(vol, _) => service.upload_volume_3d_labelaware(vol, preserve_labels),
        VolumeSendable::VolF64(vol, _) => service.upload_volume_3d_labelaware(vol, preserve_labels),
        VolumeSendable::Vec4DF32(_)
        | VolumeSendable::Vec4DI16(_)
        | VolumeSendable::Vec4DU8(_)
        | VolumeSendable::Vec4DI8(_)
        | VolumeSendable::Vec4DU16(_)
        | VolumeSendable::Vec4DI32(_)
        | VolumeSendable::Vec4DU32(_)
        | VolumeSendable::Vec4DF64(_) => {
            return Err(BridgeError::Internal {
                code: 5013,
                details:
                    "Unexpected 4D volume in GPU allocation - should have been extracted to 3D"
                        .to_string(),
            });
        }
    }
    .map_err(failed)?;
    let slot = service
        .slot_handle(index)
        .ok_or_else(|| gpu_allocation_error(layer_id, "the upload left no resident slot"))?;
    Ok((slot, world_to_voxel))
}

/// Preserve authoritative admission pressure across IPC; other renderer errors
/// retain their existing user-facing conversion.
pub(crate) fn renderer_gpu_error(
    layer_id: &str,
    error: render_loop::RenderLoopError,
) -> BridgeError {
    match error {
        render_loop::RenderLoopError::GpuBudgetExceeded {
            requested_bytes,
            used_bytes,
            budget_bytes,
        } => BridgeError::GpuBudgetExceeded {
            code: 6008,
            requested_bytes,
            used_bytes,
            budget_bytes,
        },
        error => gpu_allocation_error(layer_id, &error.to_string()),
    }
}

fn retryable_budget_pressure(error: &BridgeError) -> bool {
    matches!(error, BridgeError::GpuBudgetExceeded { requested_bytes, budget_bytes, .. } if requested_bytes <= budget_bytes)
}

// Helper function to allocate GPU resources for a layer on-demand
pub(crate) async fn allocate_gpu_resources_for_layer(
    layer_id: &str,
    volume_id: &str,
    state: &BridgeState,
    render_service: &mut RenderLoopService,
    timepoint: Option<usize>,
) -> BridgeResult<VolumeLayerGpuInfo> {
    info!(
        "Allocating GPU resources on-demand for layer '{}' (volume '{}', timepoint: {:?})",
        layer_id, volume_id, timepoint
    );

    // The volume, its label intent and its editable revision, read together:
    // an editable document's labels and revision must match.
    let volume_registry_guard = state.volume_registry.lock().await;
    let volume_arc = volume_registry_guard
        .get_render_arc(volume_id)
        .ok_or_else(|| BridgeError::VolumeNotFound {
            code: 4042,
            details: volume_id.to_owned(),
        })?;
    let entry = volume_registry_guard.get_entry(volume_id);
    let is_label_atlas = entry.is_some_and(|e| e.metadata.path.starts_with("atlas:"));
    let editable_revision = entry.and_then(|e| e.editable_revision);
    drop(volume_registry_guard);
    let volume_data = volume_arc.as_ref();
    let uploaded_timepoint = if volume_sendable_uses_timepoint(volume_data) {
        timepoint
    } else {
        None
    };

    // For 4D volumes, extract the appropriate timepoint
    let volume_to_upload = if let Some(tp) = timepoint {
        // Check if this is a 4D volume
        match volume_data {
            VolumeSendable::Vec4DF32(_)
            | VolumeSendable::Vec4DI16(_)
            | VolumeSendable::Vec4DU8(_)
            | VolumeSendable::Vec4DI8(_)
            | VolumeSendable::Vec4DU16(_)
            | VolumeSendable::Vec4DI32(_)
            | VolumeSendable::Vec4DU32(_)
            | VolumeSendable::Vec4DF64(_) => {
                info!("Extracting timepoint {} from 4D volume", tp);
                // Extract 3D volume at the specified timepoint
                let extracted = extract_3d_volume_at_timepoint(volume_data, tp)?;
                // We need to store this extracted volume temporarily
                std::borrow::Cow::Owned(extracted)
            }
            // For 3D volumes, just use as-is
            _ => std::borrow::Cow::Borrowed(volume_data),
        }
    } else {
        // No timepoint specified, use volume as-is
        std::borrow::Cow::Borrowed(volume_data)
    };

    // The renderer lock serializes this reclamation with swaps and uploads.
    if render_service.residency_metrics().resident_limit.is_some()
        && render_service.free_volume_slot_count() == 0
    {
        let mut sets = state.resident_image_sets.lock().await;
        reclaim_cached_image_slot(&mut sets, render_service);
    }

    // Upload to GPU (data range is retrieved from render metadata after upload).
    // A frame extracted from a 4D volume is never a whole label volume.
    let preserve_labels = is_label_atlas && uploaded_timepoint.is_none();
    let mut result = upload_layer_volume(
        render_service,
        layer_id,
        volume_to_upload.as_ref(),
        preserve_labels,
        editable_revision,
    );
    while result.as_ref().is_err_and(retryable_budget_pressure) {
        let reclaimed = {
            let mut sets = state.resident_image_sets.lock().await;
            reclaim_cached_image_members(&mut sets, render_service, 1)
        };
        if reclaimed == 0 {
            break;
        }
        result = upload_layer_volume(
            render_service,
            layer_id,
            volume_to_upload.as_ref(),
            preserve_labels,
            editable_revision,
        );
    }
    let (slot, _world_to_voxel) = result?;
    let atlas_idx = slot.index();

    let (min_val, max_val) = render_service
        .get_volume_data_range(atlas_idx)
        .unwrap_or_else(|| {
            warn!(
                "On-demand allocation missing cached data_range for atlas index {}; falling back to CPU scan",
                atlas_idx
            );
            compute_data_range_from_volume(volume_to_upload.as_ref())
        });

    // A lease left from an earlier allocation of the layer goes before this
    // one maps itself, so its release never takes this residency's maps.
    release_superseded_lease(state, layer_id, render_service).await;

    // Store the mapping
    {
        let mut layer_map = state.layer_slots.lock().await;
        debug!(
            "📌 STORING in allocate_gpu_resources_for_layer: layer '{}' -> atlas index {}",
            layer_id, atlas_idx
        );
        layer_map.insert(layer_id, slot);
        debug!(
            "📌 Layer map now contains {} entries: {:?}",
            layer_map.len(),
            layer_map.iter().map(|(id, _)| id).collect::<Vec<_>>()
        );

        // Also store the volume handle mapping
        let mut volume_map = state.layer_to_volume_map.lock().await;
        volume_map.insert(layer_id.to_string(), volume_id.to_string());

        let mut timepoint_map = state.layer_to_timepoint_map.lock().await;
        timepoint_map.insert(layer_id.to_string(), uploaded_timepoint);
    }

    // Like an explicit request, this allocation has a lease, so release paths
    // and the watchdog see it (inserted with the maps above).
    state.layer_leases.lock().await.insert(
        layer_id.to_string(),
        Arc::new(LayerLease::for_state(state, layer_id.to_string(), slot)),
    );

    // Register the volume with the correct data range
    if let Err(e) = render_service.register_volume_with_range(
        volume_id.to_string(),
        atlas_idx,
        (min_val, max_val),
    ) {
        warn!(
            "Failed to register volume {} with atlas index {} and range ({}, {}): {:?}",
            volume_id, atlas_idx, min_val, max_val, e
        );
    } else {
        info!(
            "Successfully registered volume '{}' with atlas index {} and data range ({}, {})",
            volume_id, atlas_idx, min_val, max_val
        );
    }

    // Return minimal GPU info - we only need the atlas index for rendering
    Ok(VolumeLayerGpuInfo {
        layer_id: layer_id.to_string(),
        world_to_voxel: [0.0; 16], // Not needed for on-demand allocation
        dim: [1, 1, 1],            // Not needed
        pad_slices: 0,
        tex_format: uploaded_gpu_format(render_service, atlas_idx)?,
        atlas_layer_index: atlas_idx,
        slice_info: SliceInfo {
            // Dummy slice info
            axis: 2, // Axial
            index: 0,
            axis_name: "Axial".to_string(),
            dimensions: [512, 512],
        },
        texture_coords: TextureCoordinates {
            u_min: 0.0,
            v_min: 0.0,
            u_max: 1.0,
            v_max: 1.0,
        },
        voxel_to_world: [0.0; 16], // Not needed
        origin: [0.0, 0.0, 0.0],
        center_world: [0.0, 0.0, 0.0],
        spacing: [1.0, 1.0, 1.0],
        data_range: Some(DataRange {
            min: min_val,
            max: max_val,
        }),
        source_volume_id: volume_id.to_string(),
        allocated_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs(),
        // A true {0, 1} image, not merely data within [0, 1].
        is_binary_like: min_val >= 0.0
            && max_val <= 1.0
            && volume_queries::is_binary_volume(volume_to_upload.as_ref()),
    })
}

/// Report allocated storage, rather than guessing from the source voxel type.
pub(crate) fn uploaded_gpu_format(
    service: &RenderLoopService,
    slot: u32,
) -> BridgeResult<GpuTextureFormat> {
    match service.get_volume_texture_format(slot) {
        Some(wgpu::TextureFormat::R8Unorm) => Ok(GpuTextureFormat::R8Unorm),
        Some(wgpu::TextureFormat::R16Float) => Ok(GpuTextureFormat::R16Float),
        Some(wgpu::TextureFormat::R32Float) => Ok(GpuTextureFormat::R32Float),
        format => Err(BridgeError::Internal {
            code: 5015,
            details: format!(
                "Unsupported or missing uploaded texture format at slot {slot}: {format:?}"
            ),
        }),
    }
}

#[cfg(test)]
mod budget_error_tests {
    use super::*;
    #[test]
    fn typed_budget_pressure_survives_renderer_conversion() {
        let error = renderer_gpu_error(
            "layer",
            render_loop::RenderLoopError::GpuBudgetExceeded {
                requested_bytes: 64,
                used_bytes: 96,
                budget_bytes: 128,
            },
        );
        assert!(matches!(
            error,
            BridgeError::GpuBudgetExceeded {
                code: 6008,
                requested_bytes: 64,
                used_bytes: 96,
                budget_bytes: 128
            }
        ));
        assert!(retryable_budget_pressure(&error));
        let oversized = BridgeError::GpuBudgetExceeded {
            code: 6008,
            requested_bytes: 129,
            used_bytes: 96,
            budget_bytes: 128,
        };
        assert!(!retryable_budget_pressure(&oversized));
        assert!(!retryable_budget_pressure(&BridgeError::GpuError {
            code: 6021,
            details: "draw limit".into()
        }));
    }
}
