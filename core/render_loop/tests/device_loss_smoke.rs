use pollster::block_on;

#[test]
fn device_loss_basic_recovery_does_not_panic() {
    block_on(async {
        let mut svc = render_loop::RenderLoopService::new()
            .await
            .expect("RenderLoopService should initialize");

        // Should not panic; best-effort reinit is acceptable
        svc.handle_device_loss();

        // Optionally, ensure we can call ensure_pipeline without panic when a surface is not configured
        // This will return an error if no surface, which is acceptable; we just want no panic.
        let _ = svc.ensure_pipeline("slice_world_space");
    });
}

