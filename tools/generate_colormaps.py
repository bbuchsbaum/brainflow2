#!/usr/bin/env python3
"""
Generate accurate colormap data for Brainflow from matplotlib colormaps.
Outputs Rust arrays in the correct format for the colormap module.
"""

import numpy as np
import matplotlib.pyplot as plt
import matplotlib.cm as cm
from pathlib import Path
import json

def generate_colormap_array(cmap_name, num_colors=256):
    """Generate a colormap array from matplotlib colormap."""
    # Get the colormap
    if cmap_name in plt.colormaps():
        cmap = plt.get_cmap(cmap_name)
    else:
        raise ValueError(f"Colormap '{cmap_name}' not found in matplotlib")
    
    # Generate normalized values from 0 to 1
    values = np.linspace(0, 1, num_colors)
    
    # Get RGBA values
    colors = cmap(values)
    
    # Convert to 0-255 range
    colors_255 = (colors * 255).astype(np.uint8)
    
    return colors_255

def format_rust_array(colors):
    """Format color array as Rust const array."""
    lines = []
    for i, color in enumerate(colors):
        r, g, b, a = color
        lines.append(f"    [{r:3}, {g:3}, {b:3}, {a:3}],")
        
    return "[\n" + "\n".join(lines) + "\n]"

def generate_colormap_file(cmap_name, output_name=None):
    """Generate a complete Rust file for a colormap."""
    if output_name is None:
        output_name = cmap_name.lower()
    
    colors = generate_colormap_array(cmap_name)
    rust_array = format_rust_array(colors)
    
    return rust_array

def save_colormap_file(cmap_name, rust_name, output_dir):
    """Save colormap to a Rust file."""
    colors = generate_colormap_array(cmap_name)
    rust_array = format_rust_array(colors)
    
    output_path = Path(output_dir) / f"{rust_name}.rs"
    
    # Just save the array data
    with open(output_path, 'w') as f:
        f.write(rust_array)
    
    print(f"Generated {output_path}")

def generate_fmri_colormap():
    """Generate fMRI red-blue diverging colormap."""
    # Create a diverging colormap from blue to red through white
    n = 256
    half = n // 2
    
    colors = np.zeros((n, 4), dtype=np.uint8)
    colors[:, 3] = 255  # Alpha channel
    
    # Blue to white (first half)
    for i in range(half):
        t = i / (half - 1)
        colors[i, 0] = int(255 * t)  # R
        colors[i, 1] = int(255 * t)  # G
        colors[i, 2] = 255           # B
    
    # White to red (second half)
    for i in range(half, n):
        t = (i - half) / (half - 1)
        colors[i, 0] = 255                # R
        colors[i, 1] = int(255 * (1 - t)) # G
        colors[i, 2] = int(255 * (1 - t)) # B
    
    return colors

def generate_phase_colormap():
    """Generate HSV-like phase colormap for complex data."""
    n = 256
    colors = np.zeros((n, 4), dtype=np.uint8)
    colors[:, 3] = 255  # Alpha channel
    
    # Use HSV with full saturation and value
    for i in range(n):
        h = i / n  # Hue from 0 to 1
        # Convert HSV to RGB
        c = np.array(plt.cm.hsv(h))
        colors[i, :3] = (c[:3] * 255).astype(np.uint8)
    
    return colors

def main():
    """Generate all colormap files."""
    output_dir = Path(__file__).parent.parent / "core" / "colormap" / "src" / "colormaps"
    output_dir.mkdir(exist_ok=True)
    
    # Standard matplotlib colormaps
    colormaps = {
        'viridis': 'viridis',
        'plasma': 'plasma',
        'inferno': 'inferno',
        'magma': 'magma',
        'turbo': 'turbo',
    }
    
    print("Generating matplotlib colormaps...")
    for mpl_name, rust_name in colormaps.items():
        save_colormap_file(mpl_name, rust_name, output_dir)
    
    # Generate Jet colormap (deprecated but still used)
    print("Generating jet colormap...")
    save_colormap_file('jet', 'jet', output_dir)
    
    # Generate parula (MATLAB's default colormap)
    # Since matplotlib doesn't have parula, we'll approximate it
    print("Generating parula colormap (approximation)...")
    # Parula is blue-green-yellow, we'll use a custom colormap
    n = 256
    parula_colors = np.zeros((n, 4), dtype=np.uint8)
    parula_colors[:, 3] = 255
    
    for i in range(n):
        t = i / (n - 1)
        if t < 0.5:
            # Blue to green
            s = t * 2
            parula_colors[i, 0] = int(53 + (0 - 53) * s)
            parula_colors[i, 1] = int(42 + (133 - 42) * s)
            parula_colors[i, 2] = int(134 + (113 - 134) * s)
        else:
            # Green to yellow
            s = (t - 0.5) * 2
            parula_colors[i, 0] = int(0 + (249 - 0) * s)
            parula_colors[i, 1] = int(133 + (251 - 133) * s)
            parula_colors[i, 2] = int(113 + (14 - 113) * s)
    
    with open(output_dir / "parula.rs", 'w') as f:
        f.write(format_rust_array(parula_colors))
    print(f"Generated {output_dir}/parula.rs")
    
    # Generate custom colormaps
    print("Generating fMRI red-blue colormap...")
    fmri_colors = generate_fmri_colormap()
    with open(output_dir / "fmri_redblue.rs", 'w') as f:
        f.write(format_rust_array(fmri_colors))
    print(f"Generated {output_dir}/fmri_redblue.rs")
    
    print("Generating phase colormap...")
    phase_colors = generate_phase_colormap()
    with open(output_dir / "phase.rs", 'w') as f:
        f.write(format_rust_array(phase_colors))
    print(f"Generated {output_dir}/phase.rs")
    
    # Also save a visualization of all colormaps
    print("\nGenerating colormap visualization...")
    fig, axes = plt.subplots(len(colormaps) + 4, 1, figsize=(8, 10))
    
    # Plot matplotlib colormaps
    for idx, (mpl_name, _) in enumerate(colormaps.items()):
        colors = generate_colormap_array(mpl_name)
        axes[idx].imshow([colors[:, :3]], aspect='auto')
        axes[idx].set_title(mpl_name)
        axes[idx].set_yticks([])
        axes[idx].set_xticks([0, 128, 255])
    
    # Plot custom colormaps
    idx = len(colormaps)
    
    # Parula
    axes[idx].imshow([parula_colors[:, :3]], aspect='auto')
    axes[idx].set_title('parula')
    axes[idx].set_yticks([])
    axes[idx].set_xticks([0, 128, 255])
    
    # fMRI
    axes[idx + 1].imshow([fmri_colors[:, :3]], aspect='auto')
    axes[idx + 1].set_title('fMRI red-blue')
    axes[idx + 1].set_yticks([])
    axes[idx + 1].set_xticks([0, 128, 255])
    
    # Phase
    axes[idx + 2].imshow([phase_colors[:, :3]], aspect='auto')
    axes[idx + 2].set_title('phase')
    axes[idx + 2].set_yticks([])
    axes[idx + 2].set_xticks([0, 128, 255])
    
    # Jet
    jet_colors = generate_colormap_array('jet')
    axes[idx + 3].imshow([jet_colors[:, :3]], aspect='auto')
    axes[idx + 3].set_title('jet')
    axes[idx + 3].set_yticks([])
    axes[idx + 3].set_xticks([0, 128, 255])
    
    plt.tight_layout()
    plt.savefig(output_dir.parent / 'colormap_preview.png', dpi=150)
    print(f"Saved colormap visualization to {output_dir.parent}/colormap_preview.png")
    
    print("\nDone! Generated all colormap files.")

if __name__ == "__main__":
    main()