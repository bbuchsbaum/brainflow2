#[cfg(test)]
mod crosshair_tests {
    // Use re-exported UBO struct
    use approx::assert_abs_diff_eq; // Import for float comparisons
    use bytemuck;
    use futures_intrusive::channel::shared::oneshot_channel;
    use pollster; // For blocking on async futures in tests
    use render_loop::{CrosshairUbo, RenderLoopService};
    use wgpu::Maintain; // For callback

    #[test] // Use standard sync test
    fn writes_crosshair_to_uniform_buffer() {
        // Rename test
        let service = pollster::block_on(RenderLoopService::new()).expect("init");

        let coords = [10.0, -20.5, 30.0];
        service.set_crosshair(coords);

        let device = &service.device;
        let queue = &service.queue;

        // staging buffer for read-back
        let staging = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("crosshair-staging"),
            size: std::mem::size_of::<CrosshairUbo>() as u64,
            usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        // copy UBO → staging
        let mut encoder =
            device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: None });
        encoder.copy_buffer_to_buffer(
            &service.crosshair_ubo_buffer,
            0,
            &staging,
            0,
            std::mem::size_of::<CrosshairUbo>() as u64,
        );
        queue.submit(Some(encoder.finish()));

        // make sure copy finished
        device.poll(Maintain::Wait); // <-- First poll (copy done)

        // 6. request mapping – provide the callback
        let slice = staging.slice(..);
        let (sender, receiver) = oneshot_channel();
        slice.map_async(wgpu::MapMode::Read, move |res| {
            sender
                .send(res)
                .expect("Failed to send map_async result via channel");
        });

        // 7. drive the GPU and wait for the callback to execute
        device.poll(Maintain::Wait); // <-- Second poll to drive callback
        let map_result = pollster::block_on(receiver.receive())
            .expect("Failed to receive map_async callback via channel");
        map_result.expect("map_async failed"); // Check the Result sent via channel

        // read back
        {
            let data = slice.get_mapped_range();
            let ubo: &CrosshairUbo = bytemuck::from_bytes(&data);

            assert_abs_diff_eq!(ubo.world_position[0], coords[0], epsilon = 1e-5);
            assert_abs_diff_eq!(ubo.world_position[1], coords[1], epsilon = 1e-5);
            assert_abs_diff_eq!(ubo.world_position[2], coords[2], epsilon = 1e-5);
        }

        staging.unmap();
    }
}
