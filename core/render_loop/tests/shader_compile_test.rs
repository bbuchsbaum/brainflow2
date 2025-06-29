#[cfg(test)]
mod shader_compile_tests {
    use wgpu;
    // Assuming a helper exists to get a headless device, like in the crosshair test
    // If not, we need to create one here.
    // use crate::tests::util; // Hypothetical util module

    async fn headless_device() -> wgpu::Device {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::default());
        let adapter = instance.request_adapter(&wgpu::RequestAdapterOptions::default())
            .await
            .expect("Failed to find an appropriate adapter");
        let (device, _queue) = adapter.request_device(
            &wgpu::DeviceDescriptor { label: None, required_features: wgpu::Features::empty(), required_limits: wgpu::Limits::downlevel_webgl2_defaults() },
            None,
        ).await.expect("Failed to create device");
        device
    }

    #[tokio::test]
    async fn shader_compiles() {
        println!("Running shader compile test...");
        let device = headless_device().await;
        println!("Headless device obtained.");

        // Use include_str! to load the shader source
        let shader_source = include_str!("../shaders/slice_simplified.wgsl");
        println!("Shader source loaded.");

        // Attempt to create the shader module
        let _shader_module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("slice_simplified.wgsl (compile test)"),
            source: wgpu::ShaderSource::Wgsl(shader_source.into()),
        });
        // If create_shader_module doesn't panic, the shader compiled successfully (syntax check).
        println!("Shader module created successfully. WGSL syntax OK.");
    }
} 