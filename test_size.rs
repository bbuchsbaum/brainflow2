use std::mem;

#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct LayerMetadata {
    pub active_count: u32,
    pub _padding: [u32; 3],
}

fn main() {
    println\!("Size of LayerMetadata: {} bytes", mem::size_of::<LayerMetadata>());
}
