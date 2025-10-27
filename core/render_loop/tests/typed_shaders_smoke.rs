#![cfg(feature = "typed-shaders")]

use render_loop::RenderLoopService;

/// Basic smoke test that ensures the typed shader bindings compile
/// and load successfully when the feature flag is enabled.
#[test]
fn typed_shader_bindings_load() {
    pollster::block_on(async {
        let mut service = RenderLoopService::new()
            .await
            .expect("RenderLoopService should initialize under typed-shaders");

        service
            .load_shaders()
            .expect("typed slice shaders should load without error");
    });
}
