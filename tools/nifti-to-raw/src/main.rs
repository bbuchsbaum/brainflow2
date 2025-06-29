use nifti::{NiftiHeader, InMemNiftiVolume, IntoNdArray, NiftiVolume};
use nalgebra::{Matrix4, Affine3};
use std::fs::File;
use std::io::{BufReader, Write};
use anyhow::Result;
use serde_json::json;

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 3 {
        eprintln!("Usage: {} <input.nii> <output_prefix>", args[0]);
        std::process::exit(1);
    }
    
    let input_path = &args[1];
    let output_prefix = &args[2];
    
    println!("Converting NIfTI file: {}", input_path);
    
    // Load NIfTI
    let file = File::open(input_path)?;
    let mut reader = BufReader::new(file);
    
    // Read header
    let header = NiftiHeader::from_reader(&mut reader)?;
    
    // Read volume
    let volume = InMemNiftiVolume::from_reader(&mut reader, &header)?;
    
    // Get dimensions
    let dims = volume.dim().to_vec();
    println!("Dimensions: {:?}", dims);
    println!("Data type: {:?}", volume.data_type());
    
    // Extract affine
    let affine = extract_affine(&header);
    println!("Affine matrix extracted");
    
    // Convert to f32 array
    let data: Vec<f32> = match volume.into_ndarray::<f32>() {
        Ok(array) => {
            array.into_raw_vec()
        }
        Err(e) => {
            eprintln!("Failed to convert to ndarray: {}", e);
            std::process::exit(1);
        }
    };
    
    println!("Data converted to f32: {} voxels", data.len());
    
    // Calculate data range
    let min = data.iter().fold(f32::INFINITY, |a, &b| a.min(b));
    let max = data.iter().fold(f32::NEG_INFINITY, |a, &b| a.max(b));
    println!("Data range: [{}, {}]", min, max);
    
    // Write raw data
    let data_path = format!("{}.raw", output_prefix);
    let mut data_file = File::create(&data_path)?;
    for &value in &data {
        data_file.write_all(&value.to_le_bytes())?;
    }
    println!("Wrote raw data to: {}", data_path);
    
    // Write metadata
    let meta = json!({
        "dims": [dims[0], dims[1], dims[2]],
        "data_type": "f32",
        "data_range": [min, max],
        "affine": affine.to_homogeneous().as_slice().to_vec(),
        "origin": [
            affine[(0, 3)],
            affine[(1, 3)],
            affine[(2, 3)]
        ],
        "spacing": [
            (affine[(0, 0)].powi(2) + affine[(1, 0)].powi(2) + affine[(2, 0)].powi(2)).sqrt(),
            (affine[(0, 1)].powi(2) + affine[(1, 1)].powi(2) + affine[(2, 1)].powi(2)).sqrt(),
            (affine[(0, 2)].powi(2) + affine[(1, 2)].powi(2) + affine[(2, 2)].powi(2)).sqrt()
        ]
    });
    
    let meta_path = format!("{}.json", output_prefix);
    let meta_str = serde_json::to_string_pretty(&meta)?;
    std::fs::write(&meta_path, meta_str)?;
    println!("Wrote metadata to: {}", meta_path);
    
    println!("\nConversion complete!");
    Ok(())
}

fn extract_affine(header: &NiftiHeader) -> Affine3<f32> {
    // For simplicity, just use pixdim to create a basic affine
    // The actual sform/qform handling would require more complex logic
    let matrix = Matrix4::new(
        header.pixdim[1], 0.0, 0.0, 0.0,
        0.0, header.pixdim[2], 0.0, 0.0,
        0.0, 0.0, header.pixdim[3], 0.0,
        0.0, 0.0, 0.0, 1.0,
    );
    
    Affine3::from_matrix_unchecked(matrix)
}