			const unsubscribeColormap = eventBus.on(
				'layer.colormap.changed',
				({ layerId: id, colormap }) => {
					console.log('[OrthogonalViewGPU] Colormap change event received:', {
						eventLayerId: id,
						effectiveLayerId,
						layerGpu: !!layerGpu,
						currentLayerIndex,
						colormap,
						willUpdate: id === effectiveLayerId && !!layerGpu
					});
					if (id === effectiveLayerId && layerGpu) {
						console.log('[OrthogonalViewGPU] Processing colormap change for layer', id, 'to', colormap);
						console.log('[OrthogonalViewGPU] Current layer state:', {
							layerId: layer?.id,
							layerColormap: layer?.colormap,
							eventColormap: colormap,
							currentLayerIndex
						});
						
						// AGGRESSIVE FIX: Always clear and recreate layer on colormap change
						// This ensures we don't have layer accumulation issues
						(async () => {
							try {
								console.log('[OrthogonalViewGPU] Clearing all layers and recreating with new colormap');
								
								// Clear all GPU layers
								await coreApi.clear_render_layers();
								
								// Reset our tracking
								currentLayerIndex = null;
								layerAdded = false;
								
								// Re-add the layer (will use new colormap from store)
								await addLayerToRenderState();
								
								// Render the new frame
								await renderFrame();
								
								console.log('[OrthogonalViewGPU] Successfully recreated layer with new colormap');
							} catch (err) {
								console.error('[OrthogonalViewGPU] Failed to recreate layer with new colormap:', err);
							}
						})();
					}
				}
			);