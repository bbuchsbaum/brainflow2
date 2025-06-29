#!/usr/bin/env python3
import os
import nibabel as nib
import numpy as np

# Create a 10x10x10 test volume
data = np.zeros((10, 10, 10), dtype=np.float32)

# Fill with some test pattern
for i in range(10):
    for j in range(10):
        for k in range(10):
            data[i, j, k] = i*100 + j*10 + k  # Simple pattern

# Create an affine matrix (identity transform with 1mm spacing and 0,0,0 origin)
affine = np.array([
    [1.0, 0.0, 0.0, 0.0],
    [0.0, 1.0, 0.0, 0.0],
    [0.0, 0.0, 1.0, 0.0],
    [0.0, 0.0, 0.0, 1.0]
], dtype=np.float32)

# Create NIfTI image
img = nib.Nifti1Image(data, affine)

# Set sform_code to 1 to trigger sform usage
img.header['sform_code'] = 1

# Save the file
os.makedirs('test-data/unit', exist_ok=True)
img.to_filename('test-data/unit/toy_t1w.nii.gz')

print('Created test-data/unit/toy_t1w.nii.gz')
print(f'Data shape: {data.shape}, Data type: {data.dtype}')
print(f'Affine matrix:\n{affine}') 