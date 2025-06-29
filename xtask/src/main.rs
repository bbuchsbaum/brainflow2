use std::path::PathBuf;
use std::process::Command;
use std::fs;
use anyhow::{Context, Result};
use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(author, version, about, long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Generate TypeScript bindings from Rust types
    TsBindings,
}

fn main() -> Result<()> {
    let cli = Cli::parse();

    match &cli.command {
        Commands::TsBindings => generate_ts_bindings(),
    }
}

/// The root of the repository
fn project_root() -> PathBuf {
    let current_dir = std::env::current_dir().expect("Failed to get current directory");
    current_dir
}

/// Runs a command and ensures it was successful
fn run(cmd: &mut Command, action_description: &str) -> Result<()> {
    println!("Running: {:?}", cmd);
    let status = cmd.status().with_context(|| format!("Failed to execute: {}", action_description))?;
    
    if !status.success() {
        anyhow::bail!("Command failed: {}", action_description);
    }
    
    Ok(())
}

/// Generate TypeScript bindings from Rust types
fn generate_ts_bindings() -> Result<()> {
    println!("Generating TypeScript bindings from Rust types...");
    
    // Create the output directory if it doesn't exist
    let output_dir = project_root().join("packages/api/src/generated");
    fs::create_dir_all(&output_dir).context("Failed to create output directory")?;
    
    // Set the TS_RS_EXPORT_DIR environment variable for ts-rs
    std::env::set_var("TS_RS_EXPORT_DIR", &output_dir);
    println!("Set TS_RS_EXPORT_DIR to: {}", output_dir.display());
    
    // Build crates that have types to export
    let crates_to_build = vec!["bridge_types", "api_bridge"];
    
    // First, we need to build with the TS_RS_EXPORT_DIR set
    println!("Building crates to generate TypeScript bindings...");
    
    // Build the export binaries - this will trigger ts-rs to generate files
    for crate_name in &crates_to_build {
        println!("Building export binary for {}...", crate_name);
        let mut build_cmd = Command::new("cargo");
        build_cmd.current_dir(&project_root())
            .env("TS_RS_EXPORT_DIR", &output_dir)
            .args(["build", "--package", crate_name, "--bin", "export_types"]);
        
        run(&mut build_cmd, &format!("Building {} export binary", crate_name))?;
        
        // Now run the binary to actually generate the types
        println!("Running export binary for {}...", crate_name);
        let mut run_cmd = Command::new("cargo");
        run_cmd.current_dir(&project_root())
            .env("TS_RS_EXPORT_DIR", &output_dir)
            .args(["run", "--package", crate_name, "--bin", "export_types"]);
        
        run(&mut run_cmd, &format!("Running {} export binary", crate_name))?;
    }
    
    // Check what files were generated
    let generated_files: Vec<_> = fs::read_dir(&output_dir)?
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            entry.path().extension()
                .map(|ext| ext == "ts")
                .unwrap_or(false)
        })
        .collect();
    
    if generated_files.is_empty() {
        println!("Warning: No TypeScript files were generated. Make sure types are marked with #[ts(export)]");
    } else {
        println!("Generated {} TypeScript files:", generated_files.len());
        for entry in &generated_files {
            println!("  - {}", entry.file_name().to_string_lossy());
        }
    }
    
    // Create an index.ts that exports all generated files
    let mut index_content = String::from("// Auto-generated TypeScript bindings\n// DO NOT EDIT - Changes will be overwritten\n\n");
    
    for entry in generated_files {
        let path = entry.path();
        if let Some(file_stem) = path.file_stem() {
            let stem_str = file_stem.to_string_lossy();
            if stem_str != "index" {
                index_content.push_str(&format!("export * from './{}';\n", stem_str));
            }
        }
    }
    
    // Write the index.ts file
    fs::write(output_dir.join("index.ts"), index_content)
        .context("Failed to write index.ts file")?;
    
    println!("TypeScript bindings generated successfully!");
    Ok(())
} 