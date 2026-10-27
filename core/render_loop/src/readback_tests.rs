use super::*;
use std::time::Duration;

async fn service() -> RenderLoopService {
    RenderLoopService::new().await.expect("real GPU required")
}

fn texture(service: &RenderLoopService, size: [u32; 2]) -> wgpu::Texture {
    let texture = service.device.create_texture(&wgpu::TextureDescriptor {
        label: Some("asymmetric readback witness"),
        size: wgpu::Extent3d {
            width: size[0],
            height: size[1],
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::COPY_DST | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let mut bytes = Vec::new();
    for y in 0..size[1] {
        for x in 0..size[0] {
            bytes.extend_from_slice(&[x as u8, y as u8, (x ^ y) as u8, 255]);
        }
    }
    service.queue.write_texture(
        wgpu::ImageCopyTexture {
            texture: &texture,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        &bytes,
        wgpu::ImageDataLayout {
            offset: 0,
            bytes_per_row: Some(size[0] * 4),
            rows_per_image: Some(size[1]),
        },
        wgpu::Extent3d {
            width: size[0],
            height: size[1],
            depth_or_array_layers: 1,
        },
    );
    texture
}

// Independent witness for the previous synchronous copy/map/unpack algorithm.
// In particular this never calls the production padding/Y-flip helper.
fn legacy_pixels(service: &RenderLoopService, texture: &wgpu::Texture, size: [u32; 2]) -> Vec<u8> {
    let row = size[0] as usize * 4;
    let stride = (row + 255) & !255;
    let buffer = service.device.create_buffer(&wgpu::BufferDescriptor {
        label: None,
        size: (stride * size[1] as usize) as u64,
        usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    });
    let mut encoder = service.device.create_command_encoder(&Default::default());
    encoder.copy_texture_to_buffer(
        wgpu::ImageCopyTexture {
            texture,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        wgpu::ImageCopyBuffer {
            buffer: &buffer,
            layout: wgpu::ImageDataLayout {
                offset: 0,
                bytes_per_row: Some(stride as u32),
                rows_per_image: Some(size[1]),
            },
        },
        wgpu::Extent3d {
            width: size[0],
            height: size[1],
            depth_or_array_layers: 1,
        },
    );
    service.queue.submit(Some(encoder.finish()));
    let (send, receive) = std::sync::mpsc::channel();
    buffer
        .slice(..)
        .map_async(wgpu::MapMode::Read, move |result| {
            send.send(result).unwrap();
        });
    service.device.poll(wgpu::Maintain::Wait);
    receive.recv().unwrap().unwrap();
    let mapped = buffer.slice(..).get_mapped_range();
    let mut pixels = vec![0; row * size[1] as usize];
    for y in 0..size[1] as usize {
        let src = (size[1] as usize - y - 1) * stride;
        pixels[y * row..(y + 1) * row].copy_from_slice(&mapped[src..src + row]);
    }
    drop(mapped);
    buffer.unmap();
    pixels
}

async fn drained(monitor: &ReadbackMonitor) {
    tokio::time::timeout(Duration::from_secs(3), async {
        while monitor.snapshot().buffers != 0 {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .expect("all staging buffers reclaimed");
    assert_eq!(monitor.snapshot().bytes, 0);
}

#[tokio::test]
async fn async_pixels_match_legacy_and_independent_asymmetric_rows() {
    let service = service().await;
    for size in [[1, 3], [63, 7], [64, 5], [65, 7], [257, 3]] {
        let texture = texture(&service, size);
        let reference = legacy_pixels(&service, &texture, size);
        let pixels = service
            .submit_texture_readback(&texture, size, vec![])
            .unwrap()
            .complete()
            .await
            .unwrap()
            .remove(0);
        assert_eq!(pixels, reference);
        for y in 0..size[1] {
            for x in 0..size[0] {
                let at = ((y * size[0] + x) * 4) as usize;
                let source_y = size[1] - y - 1;
                assert_eq!(
                    &pixels[at..at + 4],
                    &[x as u8, source_y as u8, (x ^ source_y) as u8, 255]
                );
            }
        }
    }
    drained(&service.readback_monitor()).await;
}

struct Pause(Arc<TestPollGate>);
impl Drop for Pause {
    fn drop(&mut self) {
        self.0.resume();
    }
}

#[tokio::test]
async fn cancellation_retains_buffer_until_callback_and_does_not_block_executor() {
    let service = service().await;
    let texture = texture(&service, [65, 7]);
    let pause = Pause(Arc::clone(&service.readback_driver.gate));
    *pause.0.paused.lock().unwrap() = true;
    let monitor = service.readback_monitor();
    let pending = service
        .submit_texture_readback(&texture, [65, 7], vec![])
        .unwrap();
    let mut future = Box::pin(pending.complete());
    // Rescue a broken blocking implementation so the test fails rather than hangs.
    let (progress, receive) = std::sync::mpsc::channel();
    let rescue_gate = Arc::clone(&pause.0);
    let rescue = std::thread::spawn(move || {
        let _ = receive.recv_timeout(Duration::from_secs(2));
        rescue_gate.resume();
    });
    tokio::select! {
        biased;
        _ = tokio::time::sleep(Duration::from_millis(10)) => {},
        _ = &mut future => panic!("readback completed before native progress was admitted"),
    }
    drop(future);
    assert_eq!(
        monitor.snapshot().buffers,
        1,
        "callback must retain ownership after cancellation"
    );
    progress.send(()).unwrap();
    drop(pause);
    drained(&monitor).await;
    rescue.join().unwrap();
}

#[tokio::test]
async fn mapping_failure_is_an_error_and_reclaims_payload() {
    let service = service().await;
    let pause = Pause(Arc::clone(&service.readback_driver.gate));
    *pause.0.paused.lock().unwrap() = true;
    let region = ReadbackRegion::new([1, 1], 0, service.device.limits().max_buffer_size).unwrap();
    let buffer = service
        .readback_driver
        .buffer(region.bytes, "mapping failure")
        .unwrap();
    let pending = service
        .readback_driver
        .map(Arc::clone(&buffer), vec![region], vec![])
        .unwrap();
    buffer.buffer.destroy();
    drop(buffer);
    drop(pause);
    assert!(pending.complete().await.is_err());
    drained(&service.readback_monitor()).await;
}

#[tokio::test]
async fn exhausted_staging_budget_is_classified_for_graceful_degradation() {
    let service = service().await;
    let texture = texture(&service, [4, 2]);
    let pause = Pause(Arc::clone(&service.readback_driver.gate));
    *pause.0.paused.lock().unwrap() = true;
    // Sixteen staged readbacks fill the budget; the seventeenth is refused
    // with the code the frame path turns into a placeholder frame.
    let pending: Vec<_> = (0..16)
        .map(|_| {
            service
                .submit_texture_readback(&texture, [4, 2], vec![])
                .unwrap()
        })
        .collect();
    let refused = service
        .submit_texture_readback(&texture, [4, 2], vec![])
        .err()
        .expect("budget exhausted");
    assert!(super::is_staging_budget_exhausted(&refused));
    assert!(!super::is_staging_budget_exhausted(
        &RenderLoopError::Internal {
            code: 1,
            details: String::new(),
        }
    ));
    let grey = super::placeholder_frame([4, 2]);
    assert_eq!(grey.len(), 4 * 2 * 4);
    assert!(grey.chunks_exact(4).all(|px| px == [128, 128, 128, 255]));
    drop(pause);
    for readback in pending {
        readback.complete().await.unwrap();
    }
    drained(&service.readback_monitor()).await;
}
