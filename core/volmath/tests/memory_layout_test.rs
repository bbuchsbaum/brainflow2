use volmath::space::{GridSpace, NeuroSpace3, NeuroSpaceImpl};
use volmath::dense_vol::DenseVolume3;
use volmath::traits::Volume;
use nalgebra::Matrix4;

#[test]
fn test_memory_layout_indexing() {
    // Create a 3x3x3 volume with sequential values
    let dims = [3, 3, 3];
    let mut data = Vec::with_capacity(27);
    
    // Fill with sequential values 1-27
    for i in 0..27 {
        data.push((i + 1) as f32);
    }
    
    // Create a simple identity space
    let affine = Matrix4::<f32>::identity();
    let space = NeuroSpaceImpl::<3>::from_affine_matrix4(dims, affine);
    let neuro_space = NeuroSpace3(space);
    
    // Create volume from data
    let volume = DenseVolume3::<f32>::from_data(neuro_space, data);
    
    // Test specific voxel accesses to verify C-order indexing
    // In C-order: data[z * 9 + y * 3 + x]
    
    // Test (0,0,0) = index 0 = value 1
    assert_eq!(volume.get(&[0, 0, 0]), Some(1.0), "Failed at (0,0,0)");
    
    // Test (1,0,0) = index 1 = value 2
    assert_eq!(volume.get(&[1, 0, 0]), Some(2.0), "Failed at (1,0,0)");
    
    // Test (2,0,0) = index 2 = value 3
    assert_eq!(volume.get(&[2, 0, 0]), Some(3.0), "Failed at (2,0,0)");
    
    // Test (0,1,0) = index 3 = value 4
    assert_eq!(volume.get(&[0, 1, 0]), Some(4.0), "Failed at (0,1,0)");
    
    // Test (1,1,0) = index 4 = value 5
    assert_eq!(volume.get(&[1, 1, 0]), Some(5.0), "Failed at (1,1,0)");
    
    // Test (0,0,1) = index 9 = value 10
    assert_eq!(volume.get(&[0, 0, 1]), Some(10.0), "Failed at (0,0,1)");
    
    // Test (2,2,2) = index 26 = value 27
    assert_eq!(volume.get(&[2, 2, 2]), Some(27.0), "Failed at (2,2,2)");
    
    println!("✅ Memory layout test passed - C-order indexing is correct!");
}

#[test]
fn test_index_to_coords_roundtrip() {
    let dims = [4, 5, 6];
    let affine = Matrix4::<f32>::identity();
    let space = NeuroSpaceImpl::<3>::from_affine_matrix4(dims, affine);
    
    // Test all valid indices
    for z in 0..6 {
        for y in 0..5 {
            for x in 0..4 {
                let coords = [x, y, z];
                let index = space.grid_coords_to_index_unchecked(&coords);
                let recovered_coords = space.index_to_grid_coords(index).unwrap();
                
                assert_eq!(coords, recovered_coords, 
                    "Roundtrip failed for coords {:?} -> index {} -> coords {:?}", 
                    coords, index, recovered_coords);
            }
        }
    }
    
    println!("✅ Index-to-coords roundtrip test passed!");
}

#[test]
fn test_slice_extraction() {
    // Create a 4x4x4 volume where each voxel value encodes its position
    let dims = [4, 4, 4];
    let mut data = Vec::with_capacity(64);
    
    // Fill with values that encode position: value = x*100 + y*10 + z
    for z in 0..4 {
        for y in 0..4 {
            for x in 0..4 {
                data.push((x * 100 + y * 10 + z) as f32);
            }
        }
    }
    
    let affine = Matrix4::<f32>::identity();
    let space = NeuroSpaceImpl::<3>::from_affine_matrix4(dims, affine);
    let neuro_space = NeuroSpace3(space);
    let volume = DenseVolume3::<f32>::from_data(neuro_space, data);
    
    // Test axial slice at z=2
    // Should contain values where z=2: x*100 + y*10 + 2
    assert_eq!(volume.get(&[0, 0, 2]), Some(2.0));
    assert_eq!(volume.get(&[1, 0, 2]), Some(102.0));
    assert_eq!(volume.get(&[0, 1, 2]), Some(12.0));
    assert_eq!(volume.get(&[3, 3, 2]), Some(332.0));
    
    println!("✅ Slice extraction test passed!");
}