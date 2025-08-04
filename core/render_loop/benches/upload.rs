use criterion::{criterion_group, criterion_main, Criterion, Throughput};
use pollster::block_on;
use rand::Rng;
// Adjust imports based on actual module structure in render_loop
// Example: assuming TextureAtlas is directly under render_loop
use render_loop::TextureAtlas;
use std::num::NonZeroU64;
use wgpu::*;

const DIM: [u32; 3] = [256, 256, 256]; // ~64 MiB for f32
const BYTES: usize = (DIM[0] * DIM[1] * DIM[2]) as usize * 4; // Assuming R32Float

fn setup_gpu() -> (Instance, Adapter, Device, Queue) {
    // (Implementation as provided in discussion)
    block_on(async {
        let instance = Instance::new(InstanceDescriptor::default());
        let adapter = instance
            .request_adapter(&RequestAdapterOptions::default())
            .await
            .expect("no adapter");
        let (device, queue) = adapter
            .request_device(&DeviceDescriptor::default(), None)
            .await
            .expect("device");
        (instance, adapter, device, queue)
    })
}

fn bench_upload(c: &mut Criterion) {
    let (_inst, _adap, device, queue) = setup_gpu();
    let tex_format = TextureFormat::R32Float;
    // Create a simple texture for the benchmark target
    let texture = device.create_texture(&TextureDescriptor {
        label: Some("bench_texture"),
        size: Extent3d {
            width: DIM[0],
            height: DIM[1],
            depth_or_array_layers: DIM[2],
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: TextureDimension::D3,
        format: tex_format,
        usage: TextureUsages::COPY_DST | TextureUsages::TEXTURE_BINDING,
        view_formats: &[],
    });

    let mut vox = vec![0f32; BYTES / 4];
    rand::thread_rng().fill(&mut vox[..]);

    // Pre-allocate staging buffer
    let staging_buffer = device.create_buffer_init(&util::BufferInitDescriptor {
        label: Some("bench_staging_buffer"),
        contents: bytemuck::cast_slice(&vox),
        usage: BufferUsages::COPY_SRC,
    });

    let mut group = c.benchmark_group("Texture Upload");
    group.throughput(Throughput::Bytes(BYTES as u64));

    group.bench_function("upload_256_R32F_write_texture", |b| {
        b.iter(|| {
            // Simplified: Direct queue.write_texture call via copy_buffer_to_texture
            let mut encoder = device.create_command_encoder(&CommandEncoderDescriptor::default());
            encoder.copy_buffer_to_texture(
                ImageCopyBuffer {
                    buffer: &staging_buffer,
                    layout: ImageDataLayout {
                        offset: 0,
                        // Ensure correct bytes_per_row alignment (must be multiple of 256)
                        bytes_per_row: Some(DIM[0] * 4), // Assuming R32Float (4 bytes/pixel)
                        rows_per_image: Some(DIM[1]),    // Height
                    },
                },
                ImageCopyTexture {
                    texture: &texture,
                    mip_level: 0,
                    origin: Origin3d::ZERO,
                    aspect: TextureAspect::All,
                },
                Extent3d {
                    width: DIM[0],
                    height: DIM[1],
                    depth_or_array_layers: DIM[2],
                },
            );
            queue.submit(Some(encoder.finish()));
            // For measuring submission rate, no need to poll.
            // If measuring full GPU cycle, use device.poll(Maintain::Wait);
        })
    });

    // Placeholder for future TextureAtlas specific benchmark
    // group.bench_function("upload_256_R32F_atlas", |b| { ... });

    group.finish();
}

criterion_group!(gpu_benches, bench_upload);
criterion_main!(gpu_benches);
