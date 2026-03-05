use criterion::{criterion_group, criterion_main, Criterion, Throughput};
use pollster::block_on;
use rand::Rng;
use wgpu::util::DeviceExt;
use wgpu::*;

const DIM: [u32; 3] = [256, 256, 256]; // ~64 MiB for f32
const BYTES: usize = (DIM[0] * DIM[1] * DIM[2]) as usize * 4; // R32Float

fn setup_gpu() -> (Instance, Adapter, Device, Queue) {
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

    group.bench_function("upload_256_R32F_copy_buffer_to_texture", |b| {
        b.iter(|| {
            let mut encoder = device.create_command_encoder(&CommandEncoderDescriptor::default());
            encoder.copy_buffer_to_texture(
                ImageCopyBuffer {
                    buffer: &staging_buffer,
                    layout: ImageDataLayout {
                        offset: 0,
                        bytes_per_row: Some(DIM[0] * 4),
                        rows_per_image: Some(DIM[1]),
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
        })
    });

    group.finish();
}

criterion_group!(gpu_benches, bench_upload);
criterion_main!(gpu_benches);
