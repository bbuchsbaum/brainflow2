use render_loop::RenderLoopService;
use volmath::{DenseVolume3, NeuroSpace, NeuroSpaceExt};

#[tokio::test]
async fn repeated_volume_cycles_return_to_zero_resident_bytes() {
    let mut service = RenderLoopService::new()
        .await
        .expect("GPU adapter required");
    for cycle in 0..200 {
        let size = if cycle % 2 == 0 { 64 } else { 96 };
        let space =
            NeuroSpace::from_dims_spacing_origin(vec![size; 3], vec![1.; 3], vec![0.; 3]).unwrap();
        let volume = DenseVolume3::<f32>::from_data(space, vec![cycle as f32; size * size * size]);
        let (slot, _) = service.upload_volume_3d(&volume).unwrap();
        let manager = service.multi_texture_manager.as_ref().unwrap();
        assert_eq!(manager.resident_slot_count(), 1);
        assert!(manager.resident_bytes() > 0);
        service.release_volume(slot).unwrap();
        // queue.write_texture stages uploads until a submit. Advance and drain
        // the GPU as normal frame rendering does before measuring live memory.
        service.queue.submit([]);
        service.device.poll(wgpu::Maintain::Wait);
        drop(volume);
        let manager = service.multi_texture_manager.as_ref().unwrap();
        assert_eq!(manager.resident_slot_count(), 0, "cycle {cycle}");
        assert_eq!(manager.resident_bytes(), 0, "cycle {cycle}");
        if [4, 24, 49, 99, 199].contains(&cycle) {
            // Observational RSS receipt; driver caches make RSS unsuitable for
            // an exact leak assertion. Resident texture accounting above is exact.
            #[cfg(unix)]
            if let Ok(output) = std::process::Command::new("ps")
                .args(["-o", "rss=", "-p", &std::process::id().to_string()])
                .output()
            {
                println!(
                    "cycle {}: resident slots=0 bytes=0 RSS_KiB={}",
                    cycle + 1,
                    String::from_utf8_lossy(&output.stdout).trim()
                );
            }
        }
    }
}
