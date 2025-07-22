#!/bin/bash

# Fix patterns in render_loop tests

# Fix 1: Replace NeuroSpaceImpl::from_affine_matrix4 with NeuroSpaceExt::from_affine_matrix4
find core/render_loop/tests -name "*.rs" -type f -exec sed -i '' 's/NeuroSpaceImpl::from_affine_matrix4/NeuroSpaceExt::from_affine_matrix4/g' {} +

# Fix 2: Replace NeuroSpace3(space_impl) with NeuroSpace3::new(space_impl)
find core/render_loop/tests -name "*.rs" -type f -exec sed -i '' 's/NeuroSpace3(\([^)]*\))/NeuroSpace3::new(\1)/g' {} +

# Fix 3: Add NeuroSpaceExt import where missing
# This is trickier - we'll add it after any existing volmath import

# Fix 4: Fix DenseVolume3::from_data calls to use space.0
find core/render_loop/tests -name "*.rs" -type f -exec sed -i '' 's/DenseVolume3::from_data(space,/DenseVolume3::from_data(space.0,/g' {} +

# Fix 5: Fix data_slice() calls to values()
find core/render_loop/tests -name "*.rs" -type f -exec sed -i '' 's/\.data_slice()/.values()/g' {} +

# Fix 6: Add missing is_mask field
find core/render_loop/tests -name "*.rs" -type f -exec sed -i '' 's/visible: true,$/visible: true,\n            is_mask: false,/g' {} +

echo "Pattern fixes applied. You may need to manually add 'use volmath::NeuroSpaceExt;' imports where needed."